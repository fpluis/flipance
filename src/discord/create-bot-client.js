import { Client, Intents } from "discord.js";
import { handleInteraction, registerCommands, buildEmbed } from "./index.js";
import logError from "../log-error.js";
import { readFileSync } from "fs";

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

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
  { marketplace, eventType, collectionFloor, price },
  {
    allowedMarketplaces = allMarketplaceIds,
    allowedEvents = allEventIds,
    maxOfferFloorDifference = Number(MAX_OFFER_FLOOR_DIFFERENCE),
  } = {}
) => {
  if (
    !allowedMarketplaces.includes(marketplace) ||
    !allowedEvents.includes(eventType)
  ) {
    return false;
  }

  if (eventType === "offer" && collectionFloor != null) {
    if (price >= collectionFloor) {
      return true;
    }

    const floorDifference = (collectionFloor - price) / collectionFloor;
    return 100 * floorDifference < Number(maxOfferFloorDifference);
  }

  return true;
};

export default ({ dbClient, nftClient }) =>
  new Promise((resolve, reject) => {
    const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
    const [, , testArg] = process.argv;
    discordClient.login(
      testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
    );

    if (testArg === "test") {
      console.log(`Starting the client in TEST mode`);
    }

    /*
     * Handles a collection offer event generated by the nft event emitter.
     * If the offer is higher than the current highest offer, the bot will
     * attempt to notify the discord servers that watch the collection.
     */
    const handleOffer = async ({ args, dbClient }) => {
      const {
        collection,
        marketplace,
        price,
        endsAt: offerEndsAt,
        highestOffer,
        highestOfferEndsAt,
        watchers,
        collectionFloor,
      } = args;
      if (price > highestOffer || highestOfferEndsAt < new Date().getTime()) {
        await dbClient.setCollectionOffer({
          address: collection,
          price,
          endsAt: offerEndsAt,
          marketplace,
        });
        watchers.forEach(async (watcher) => {
          const { discordId, channelId, tokenIds } = watcher;
          if (isAllowedByPreferences({ ...args, collectionFloor }, watcher)) {
            try {
              const isUserMessage = channelId == null;
              const target = await (isUserMessage
                ? discordClient.users.fetch(discordId)
                : discordClient.channels.fetch(channelId));
              const embed = await buildEmbed({
                ...args,
                collectionFloor,
                target: isUserMessage ? "user" : "server",
                tokenIds,
              });
              target.send(embed).catch((error) => {
                logError(
                  `Error sending bid notification to ${channelId}/${discordId}; Error: ${error.toString()}`
                );
              });
            } catch (error) {
              logError(
                `Error handling bid with args ${JSON.stringify({
                  ...args,
                })}: ${error.toString()}`
              );
            }
          }
        });
      }
    };

    /*
     * Handles a collection listing event generated by the nft event emitter.
     */
    const handleListing = async ({ args, dbClient }) => {
      const {
        collection,
        marketplace,
        price,
        watchers,
        collectionFloor,
        seller,
      } = args;
      if (collectionFloor == null || price < collectionFloor) {
        await dbClient.setCollectionFloor({
          address: collection,
          price,
          marketplace,
        });
      }

      watchers.forEach(async (watcher) => {
        const { discordId, channelId, address } = watcher;
        const isUserMessage = channelId == null;
        if (
          isAllowedByPreferences(args, watcher) &&
          (!isUserMessage || address === seller)
        ) {
          try {
            const target = await (isUserMessage
              ? discordClient.users.fetch(discordId)
              : discordClient.channels.fetch(channelId));
            const embed = await buildEmbed({
              ...args,
              target: isUserMessage ? "user" : "server",
            });
            target.send(embed).catch((error) => {
              logError(
                `Error sending listing notification to ${channelId}/${discordId}; Error: ${error.toString()}`
              );
            });
          } catch (error) {
            logError(
              `Error handling listing with args ${JSON.stringify({
                ...args,
              })}: ${error.toString()}`
            );
          }
        }
      });
    };

    /*
     * Handle NFT events coming from the blockchain. If there is an alert
     * set up for the buyer, seller or collection, notify the user/server
     * that created that alert.
     */
    const handleNFTEvent = async ({ args, dbClient }) => {
      const {
        seller: sellerAddress = "",
        buyer: buyerAddress = "",
        collection: collectionAddress = "",
        eventType,
      } = args;

      if (eventType === "offer") {
        return handleOffer({ args, dbClient });
      }

      if (eventType === "listing") {
        return handleListing({ args, dbClient });
      }

      const { objects: sellerAlerts } = await dbClient.getAlertsByAddress({
        address: sellerAddress.toLowerCase(),
      });
      if (sellerAlerts.length > 0) {
        sellerAlerts
          .filter((alert) => isAllowedByPreferences(args, alert))
          .forEach(async ({ discordId }) => {
            try {
              const discordUser = await discordClient.users.fetch(discordId);
              const embed = await buildEmbed({
                ...args,
                isSeller: true,
              });
              discordUser.send(embed).catch((error) => {
                logError(
                  `Error sending message to seller ${discordId}; Error: ${error.toString()}`
                );
              });
            } catch (error) {
              logError(
                `Could not notify user ${discordId} of sale; Error: ${error.toString()}`
              );
            }
          });
      }

      const { objects: buyerAlerts } = await dbClient.getAlertsByAddress({
        address: buyerAddress.toLowerCase(),
      });

      if (buyerAlerts.length > 0) {
        buyerAlerts
          .filter((buyer) => isAllowedByPreferences(args, buyer))
          .forEach(async ({ discordId }) => {
            try {
              const discordUser = await discordClient.users.fetch(discordId);
              const embed = await buildEmbed({
                ...args,
                isBuyer: true,
              });
              discordUser.send(embed).catch((error) => {
                logError(
                  `Error sending message to buyer ${discordId}; Error: ${error.toString()}`
                );
              });
            } catch (error) {
              logError(
                `Could not notify user ${discordId} of purchase; Error: ${error.toString()}`
              );
            }
          });
      }

      const { objects: collectionAlerts } = await dbClient.getAlertsByAddress({
        address: collectionAddress.toLowerCase(),
      });

      if (collectionAlerts.length > 0) {
        collectionAlerts
          .filter((alert) => isAllowedByPreferences(args, alert))
          .forEach(async ({ channelId }) => {
            if (channelId == null) {
              return;
            }

            try {
              const embed = await buildEmbed({
                ...args,
              });
              const channel = await discordClient.channels.fetch(channelId);
              channel.send(embed).catch((error) => {
                logError(
                  `Error sending message to channel ${channelId}; Error: ${error.toString()}`
                );
              });
            } catch (error) {
              logError(
                `Error sending collection alert to channel ${channelId}: ${error.toString()}`
              );
            }
          });
      }

      return null;
    };

    discordClient.once("ready", async () => {
      console.log(`Logged in as ${discordClient.user.tag}!`);
      discordClient.on("interactionCreate", (interaction) => {
        handleInteraction({ discordClient, nftClient, dbClient }, interaction);
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
          handleNFTEvent({ args: event, dbClient });
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