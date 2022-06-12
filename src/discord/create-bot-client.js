import path from "path";
import dotenv from "dotenv";
import { Client, Intents } from "discord.js";
import { handleInteraction, registerCommands, buildEmbed } from "./index.js";
import logError from "../log-error.js";
import { readFileSync } from "fs";
import minimist from "minimist";

dotenv.config({ path: path.resolve(".env") });
const { MARKETPLACES } = process.env;

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const allowedMarketplaceIds =
  MARKETPLACES == null ? allMarketplaceIds : MARKETPLACES.split(",");

const argv = minimist(process.argv.slice(2));

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
const isAllowedByPreferences = (
  { marketplace, eventType, floorDifference, seller },
  {
    allowedMarketplaces = allowedMarketplaceIds,
    allowedEvents = allEventIds,
    maxOfferFloorDifference = Number(MAX_OFFER_FLOOR_DIFFERENCE),
    address,
    type: alertType,
  } = {}
) => {
  if (
    !allowedMarketplaces.includes(marketplace) ||
    !allowedEvents.includes(eventType)
  ) {
    return false;
  }

  if (eventType === "offer" && floorDifference != null) {
    if (floorDifference <= 0) {
      return true;
    }

    return 100 * floorDifference < Number(maxOfferFloorDifference);
  }

  // Don't notify wallets of listings when they are not the sellers
  if (
    eventType === "listing" &&
    !(address === seller || alertType === "collection")
  ) {
    console.log(`Non-event detected`);
    return false;
  }

  return true;
};

export default ({ dbClient, shardId, totalShards }) =>
  new Promise((resolve, reject) => {
    console.log(
      `Starting shard client with shard info ${shardId}/${totalShards}`
    );
    const discordClient = new Client({
      intents: [Intents.FLAGS.GUILDS],
      shards: shardId,
      shardCount: totalShards,
    });
    discordClient.login(argv.test ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN);

    if (argv.test) {
      console.log(`Starting the client in TEST mode`);
    }

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
        const isUserMessage = alertType === "wallet";
        if (isAllowedByPreferences(event, watcher)) {
          const embed = await buildEmbed({
            ...event,
            target: isUserMessage ? "user" : "server",
          });
          try {
            const target = await (isUserMessage
              ? discordClient.users.fetch(discordId)
              : discordClient.channels.fetch(channelId));
            target.send(embed).catch((error) => {
              logError(
                `Error sending listing notification to ${channelId}/${discordId}; Error: ${error.toString()}`
              );
            });
          } catch (error) {
            logError(
              `Error handling listing with args ${JSON.stringify({
                ...event,
              })}: ${error.toString()}`
            );
          }
        }
      });

      return Promise.resolve();
    };

    discordClient.once("ready", async () => {
      console.log(`Logged in as ${discordClient.user.tag}!`);
      discordClient.on("interactionCreate", (interaction) => {
        handleInteraction({ discordClient, dbClient }, interaction);
      });

      discordClient.on("error", (error) => {
        logError(`Discord client error: ${error.toString()}`);
        reject(error);
      });

      discordClient.on("shardError", (error) => {
        logError(`Discord client shard error: ${error.toString()}`);
        reject(error);
      });

      discordClient.on("nftEvent", (event) => {
        try {
          handleNFTEvent(event);
        } catch (error) {
          logError(
            `Error handling NFT event ${JSON.stringify(
              event
            )}: ${error.toString()}`
          );
          reject(error);
        }
      });

      resolve(discordClient);
    });

    discordClient.on("guildCreate", (guild) => {
      console.log(`Guild create event: ${guild.id}`);
      registerCommands(guild.id);
    });
  });
