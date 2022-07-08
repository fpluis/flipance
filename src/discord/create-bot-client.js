/// <reference path="../typedefs.js" />

import path from "path";
import dotenv from "dotenv";
import { Client, Intents } from "discord.js";
import { handleInteraction, registerCommands, buildEmbed } from "./index.js";
import logMessage from "../log-message.js";
import { readFileSync } from "fs";
import minimist from "minimist";
import logMetric from "../log-metric.js";

dotenv.config({ path: path.resolve(".env") });
const { MARKETPLACES } = process.env;

const MAX_MINUTE_DIFFERENCE = 10;

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const allowedMarketplaceIds =
  MARKETPLACES == null ? allMarketplaceIds : MARKETPLACES.split(",");

const isLooksRareOnlyMode =
  allowedMarketplaceIds.length === 1 &&
  allowedMarketplaceIds.includes("looksRare");

const argv = minimist(process.argv.slice(2));

const minuteDifference = (date1, date2) =>
  (date2.getTime() - date1.getTime()) / 60000;

const {
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MAX_OFFER_FLOOR_DIFFERENCE,
} = process.env;

/**
 * Checks whether a wallet alert has a token that is affected by an event.
 * @param {NFTEvent} event
 * @param {String[]} tokens
 * @return {Boolean}
 */
const hasAffectedToken = (event, tokens) => {
  const { collection, tokenId, standard, eventType } = event;
  if (tokenId == null) {
    return tokens.some((token) => {
      const [alertCollection] = token.split("/");
      return collection === alertCollection;
    });
  }

  // Filter out ERC-1155s as false positives since different tokens
  // share the same id
  return standard === "ERC-1155" && eventType !== "offer"
    ? false
    : tokens.includes(`${collection}/${tokenId}`);
};

/**
 * Determine whether a user/server should be notified of an NFT event
 * based on their preferences
 * @param {Object} params
 * @param {NFTEvent} params.event
 * @param {Alert} params.watcher
 * @param {Date} params.maxEventAge - How old the event can be to be shown to the user. * @return {Boolean}
 */
const isAllowedByPreferences = (params) => {
  const {
    event,
    watcher: {
      allowedMarketplaces = allowedMarketplaceIds,
      allowedEvents = allEventIds,
      maxOfferFloorDifference = Number(MAX_OFFER_FLOOR_DIFFERENCE),
      address: watcherAddress,
      type: alertType,
      tokens: alertTokens = [],
    } = {},
    maxEventAge,
  } = params;
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
      ![buyer, seller, initiator].includes(watcherAddress) &&
      !hasAffectedToken(event, alertTokens))
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
        ![buyer, seller, initiator].includes(watcherAddress) &&
        !hasAffectedToken(event, alertTokens),
      event,
      level: "warning",
    });

    return false;
  }

  if (
    isLooksRareOnlyMode &&
    ((eventType === "acceptOffer" && watcherAddress !== buyer) ||
      (eventType === "acceptAsk" && watcherAddress !== seller) ||
      (eventType === "offer" && [initiator, buyer].includes(watcherAddress)) ||
      (["cancelOrder", "listing"].includes(eventType) &&
        watcherAddress !== initiator))
  ) {
    return false;
  }

  if (eventType === "offer") {
    if (!isHighestOffer) {
      logMessage({
        message: `Filtered offer event`,
        isHighestOffer,
        alertType,
        tokenId,
        event,
        level: "warning",
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

/**
 * Create a bot client that receives NFT events through its returned object's emit function and handles user Discord interactions.
 * @param {Object} params
 * @param {Object} params.dbClient - The initialized database client.
 * @param {Number} params.shardId - The client's shard id.
 * @param {Number} params.totalShards - The total number of shards for the bot.
 * @return {Client}
 */
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

    /**
     * Handle NFT events coming from the blockchain. If there is an alert
     * set up for the buyer, seller or collection, notify the user/server
     * that created that alert.
     * @param {WatchedNFTEvent} event
     */
    const handleNFTEvent = async (event) => {
      const { watchers = [] } = event;
      if (watchers.length === 0) {
        return Promise.resolve();
      }

      watchers.forEach(async (watcher) => {
        const { discordId, type: alertType, channelId } = watcher;
        if (isAllowedByPreferences({ event, watcher, maxEventAge })) {
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
            target
              .send(embed)
              .then(() => {
                logMetric({ name: "total_alerts_sent" });
              })
              .catch((error) => {
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
        } else {
          logMessage({
            message: "Event filtered by preferences",
            event,
            watcher,
            maxEventAge,
            level: "info",
          });
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
