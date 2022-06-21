import path from "path";
import dotenv from "dotenv";
import { Client, Intents } from "discord.js";
import { handleInteraction, registerCommands, buildEmbed } from "./index.js";
import logMessage from "../log-message.js";
import { readFileSync } from "fs";
import minimist from "minimist";

dotenv.config({ path: path.resolve(".env") });
const { MARKETPLACES } = process.env;

const MAX_MINUTE_DIFFERENCE = 10;

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const allowedMarketplaceIds =
  MARKETPLACES == null ? allMarketplaceIds : MARKETPLACES.split(",");

const argv = minimist(process.argv.slice(2));

const minuteDifference = (date1, date2) =>
  (date2.getTime() - date1.getTime()) / 60000;

const {
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MAX_OFFER_FLOOR_DIFFERENCE,
} = process.env;

/**
 * Determine whether a user/server should be notified of an NFT event
 * based on their preferences
 * @param {Object} params
 * @param {String} params.marketplace - The marketplace id. You can find
 * the whole list at data/marketplaces.json.
 * @param {String} params.eventType - The event type.  You can find
 * the whole list at data/nft-events.json.
 * @param {Number} params.collectionFloor - The latest floor price for
 * the NFT's collection.
 * @param {Number} params.price - The price associated to the event. If
 * it is a sale, the sale price. If it's an offer, the offer price.
 * @param {Object} settings
 * @param {Array[String]} allowedMarketplaces - List of allowed marketplace ids.
 * @param {Array[String]} allowedEvents - List of allowed NFT event ids.
 * @param {Number} maxOfferFloorDifference - Max. deviation from the collection
 * floor an offer can have to be relevant to the alert.
 * @return {Boolean}
 */
const isAllowedByPreferences = ({
  event,
  watcher: {
    allowedMarketplaces = allowedMarketplaceIds,
    allowedEvents = allEventIds,
    maxOfferFloorDifference = Number(MAX_OFFER_FLOOR_DIFFERENCE),
    address: watcherAddress,
    type: alertType,
  } = {},
  maxEventAge,
}) => {
  const {
    marketplace,
    eventType,
    floorDifference,
    buyer,
    seller,
    initiator,
    createdAt,
    startsAt,
    tokenId,
    isHighestOffer,
  } = event;
  if (
    createdAt < maxEventAge ||
    minuteDifference(startsAt, maxEventAge) > MAX_MINUTE_DIFFERENCE ||
    !allowedMarketplaces.includes(marketplace) ||
    !allowedEvents.includes(eventType) ||
    (alertType === "wallet" &&
      ![buyer, seller, initiator].includes(watcherAddress))
  ) {
    logMessage({
      message: `Filtered "${eventType}" event`,
      createdTooLongAgo: createdAt < maxEventAge,
      startedTooLongAgo:
        minuteDifference(startsAt, maxEventAge) > MAX_MINUTE_DIFFERENCE,
      notAllowedMarket: !allowedMarketplaces.includes(marketplace),
      notAllowedEvent: !allowedEvents.includes(eventType),
      notForMe:
        alertType === "wallet" &&
        ![buyer, seller, initiator].includes(watcherAddress),
      event,
      level: "debug",
    });
    return false;
  }

  if (eventType === "offer") {
    if (!isHighestOffer || (alertType === "server" && tokenId != null)) {
      logMessage({
        message: `Filtered offer event`,
        isHighestOffer,
        alertType,
        tokenId,
        event,
        level: "debug",
      });
      return false;
    }

    if (floorDifference != null) {
      if (floorDifference >= 0) {
        return true;
      }

      return 100 * Math.abs(floorDifference) < Number(maxOfferFloorDifference);
    }
  }

  return true;
};

const minutesAgo = (minutes = 1) =>
  new Date(new Date().setMinutes(new Date().getMinutes() - minutes));

export default ({ dbClient, shardId, totalShards }) => {
  let maxEventAge = minutesAgo(2);

  return new Promise((resolve, reject) => {
    const discordClient = new Client({
      intents: [Intents.FLAGS.GUILDS],
      shards: Number(shardId),
      shardCount: Number(totalShards),
    });
    discordClient.login(argv.test ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN);

    if (argv.test) {
      logMessage({ message: `Starting the client in TEST mode` });
    }

    discordClient.setMaxEventAge = (age = new Date()) => {
      maxEventAge = age;
    };

    /*
     * Handle NFT events coming from the blockchain. If there is an alert
     * set up for the buyer, seller or collection, notify the user/server
     * that created that alert.
     */
    const handleNFTEvent = async (event) => {
      const { watchers = [] } = event;
      if (watchers.length === 0) {
        return Promise.resolve();
      }

      watchers.forEach(async (watcher) => {
        const { discordId, type: alertType, channelId } = watcher;
        if (isAllowedByPreferences({ event, watcher, maxEventAge })) {
          logMessage({
            message: `Notifying watcher of ${event.eventType}`,
            watcher,
            level: "debug",
          });
          const embed = await buildEmbed({
            ...event,
            watcher,
            target: alertType === "server" ? "server" : "user",
          }).catch((error) => {
            logMessage({
              message: `Error building embed with`,
              args: {
                ...event,
                target: alertType === "server" ? "server" : "user",
              },
              level: "error",
              error,
            });
          });
          try {
            const target = await (alertType === "server"
              ? discordClient.channels.fetch(channelId)
              : discordClient.users.fetch(discordId));
            target.send(embed).catch((error) => {
              logMessage({
                message: `Error sending listing notification to ${channelId}/${discordId}`,
                level: "error",
                error,
              });
            });
          } catch (error) {
            logMessage({
              message: `Error handling listing`,
              event,
              level: "error",
              error,
            });
          }
        }
      });

      return Promise.resolve();
    };

    discordClient.once("ready", async () => {
      logMessage({ message: `Logged in as ${discordClient.user.tag}` });
      discordClient.on("interactionCreate", (interaction) => {
        handleInteraction({ discordClient, dbClient }, interaction);
      });

      discordClient.on("error", (error) => {
        logMessage({ message: `Discord client error`, level: "error", error });
        reject(error);
      });

      discordClient.on("shardError", (error) => {
        logMessage({
          message: `Discord client shard error`,
          level: "error",
          error,
        });
        reject(error);
      });

      discordClient.on("nftEvent", (event) => {
        try {
          handleNFTEvent(event);
        } catch (error) {
          logMessage({
            message: `Error handling NFT event ${JSON.stringify(event)}`,
            level: "error",
            error,
          });
          reject(error);
        }
      });

      resolve(discordClient);
    });

    discordClient.on("guildCreate", (guild) => {
      logMessage({ message: `New server added the bot: ${guild.id}` });
      registerCommands(guild.id);
    });
  });
};
