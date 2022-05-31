/* eslint-disable no-await-in-loop */
import path from "path";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { Client, Intents } from "discord.js";
import {
  nftEventEmitter,
  calculateProfit,
  createNFTClient,
} from "../src/blockchain/index.js";
import {
  getCollectionFloor,
  getCollectionOffers,
} from "../src/looksrare-api/index.js";
import logError from "../src/log-error.js";
import {
  handleInteraction,
  registerCommands,
  buildEmbed,
} from "../src/discord/index.js";
import sleep from "../src/sleep.js";
import { createDbClient } from "../src/database/index.js";
import { utils as etherUtils, BigNumber } from "ethers";

dotenv.config({ path: path.resolve(".env") });

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const {
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MAX_OFFER_FLOOR_DIFFERENCE,
} = process.env;

const WAIT_BEFORE_LR_POLL_OFFERS = 60 * 1000;
const POLL_EVENTS_DELAY = 60 * 1000;
const POLL_USER_TOKENS_INTERVAL = 5 * 60 * 1000;
const POLL_COLLECTION_SLICE_DELAY = 60 * 1000;

const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
const [, , testArg] = process.argv;
discordClient.login(
  testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
);

if (testArg === "test") {
  console.log(`Starting the client in TEST mode`);
}

const isAllowedByPreferences = (
  { marketplace, saleType, collectionFloor, price },
  {
    allowedMarketplaces = allMarketplaceIds,
    allowedEvents = allEventIds,
    maxOfferFloorDifference = Number(MAX_OFFER_FLOOR_DIFFERENCE),
  } = {}
) => {
  if (
    !allowedMarketplaces.includes(marketplace) ||
    !allowedEvents.includes(saleType)
  ) {
    return false;
  }

  if (saleType === "offer" && collectionFloor != null) {
    if (price >= collectionFloor) {
      return true;
    }

    const floorDifference = (collectionFloor - price) / collectionFloor;
    return 100 * floorDifference < Number(maxOfferFloorDifference);
  }

  return true;
};

const notifySales = async ({ dbClient, nftClient }) => {
  const handleSale = async (args) => {
    const {
      seller: sellerAddress = "",
      buyer: buyerAddress = "",
      collection: collectionAddress = "",
    } = args;

    const { objects: sellerAlerts } = await dbClient.getAlertsByAddress({
      address: sellerAddress.toLowerCase(),
    });
    if (sellerAlerts.length > 0) {
      sellerAlerts
        .filter((alert) => isAllowedByPreferences(args, alert))
        .forEach(async ({ discordId }) => {
          try {
            const profit = await calculateProfit(args);
            const discordUser = await discordClient.users.fetch(discordId);
            const embed = await buildEmbed({
              ...args,
              profit,
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
            channel.send(embed);
          } catch (error) {
            logError(
              `Error sending collection alert to channel ${channelId}: ${error.toString()}`
            );
          }
        });
    }
  };

  const handleOffer = async (saleType, args) => {
    const { watchers, collection, price, endsAt, marketplace } = args;
    args.saleType = saleType;
    await dbClient.setCollectionOffer({
      address: collection,
      price,
      endsAt,
      marketplace,
    });
    watchers.forEach(async (watcher) => {
      const { discordId, channelId, tokenIds } = watcher;
      if (isAllowedByPreferences(args, watcher)) {
        try {
          const isUserMessage = channelId == null;
          const target = await (isUserMessage
            ? discordClient.users.fetch(discordId)
            : discordClient.channels.fetch(channelId));
          const embed = await buildEmbed({
            ...args,
            target: isUserMessage ? "user" : "server",
            saleType,
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
  };

  const refreshAlertTokens = async () => {
    let index = 0;
    const { objects: alerts } = await dbClient.getAllAlerts();
    while (index < alerts.length) {
      const { id, address, type, syncedAt } = alerts[index];
      if (
        type === "wallet" &&
        (syncedAt == null ||
          new Date() - new Date(syncedAt) > POLL_USER_TOKENS_INTERVAL)
      ) {
        const tokens = await nftClient.getAddressNFTs(address);
        await dbClient.setAlertTokens({ id, tokens });
        alerts[index].tokens = tokens;
        alerts[index].syncedAt = new Date();
      }

      index += 1;
    }

    return alerts;
  };

  const toCollectionMap = (alerts, offers) => {
    const collectionMap = alerts.reduce(
      (collectionMap, { id, tokens, ...alert }) => {
        const userCollections = tokens.reduce((collections, token) => {
          const [collection, tokenId] = token.split("/");
          if (tokenId.length > 0) {
            const tokenIds = collections[collection] || [];
            collections[collection] = tokenIds.concat(tokenId);
          }

          return collections;
        }, {});
        Object.entries(userCollections).forEach(([collection, tokenIds]) => {
          const { watchers: currentWatchers = [] } =
            collectionMap[collection] || {};
          collectionMap[collection] = {
            watchers: currentWatchers.concat([{ ...alert, id, tokenIds }]),
          };
        });
        offers.forEach(({ collection, price, endsAt }) => {
          const current = collectionMap[collection];
          if (current == null) {
            return;
          }

          current.price = price;
          current.endsAt = endsAt;
          collectionMap[collection] = current;
        });
        return collectionMap;
      },
      {}
    );

    return collectionMap;
  };

  const updateCollectionFloors = async (collectionMap, offset = 0) => {
    const collections = Object.keys(collectionMap).slice(offset, offset + 60);
    let index = 0;
    while (index < collections.length) {
      const collection = collections[index];
      const collectionFloor = await getCollectionFloor(collection)
        .then(async (collectionFloor) => {
          await dbClient.setCollectionFloor({
            collection,
            price: collectionFloor,
            marketplace: "looksRare",
          });
          return collectionFloor;
        })
        .catch(async () => {
          const { object } = await dbClient.getCollectionFloor({ collection });
          return object;
        });
      const current = collectionMap[collection];
      current.collectionFloor = collectionFloor;
      collectionMap[collection] = current;
      index += 1;
    }

    return collections.length > 0
      ? updateCollectionFloors(collectionMap, offset + 60)
      : collectionMap;
  };

  /**
   * Get a collection's first N offers on LooksRare, sorted by price descending
   * (the highest offer will be the first in the returned array). See
   * https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders
   * for reference.
   * @param  {Array[String, Object]} collectionEntries - Entries from a
   * collection map where the first member is the collection's address
   * and the second member is an object with the current _price_, _endsAt_,
   * _watchers_ and _collectionFloor_.
   * @param  {Function} emit - The event emitter function that must be called
   * when there is a new highest offer.
   */
  const pollCollectionOffers = async (collectionEntries, emit) => {
    await Promise.all(
      collectionEntries
        .slice(0, 60)
        .map(
          async ([
            collection,
            {
              price: currentHighest = 0,
              endsAt: currentEndsAt,
              watchers,
              collectionFloor = 0,
            },
          ]) => {
            const offers = await getCollectionOffers(collection);
            if (offers.length === 0) {
              return;
            }

            const [topOffer] = offers;
            const { price, endTime: endsAt, signer } = topOffer;
            const currentHighestInWei = etherUtils.parseEther(
              `${currentHighest}`
            );
            if (
              BigNumber.from(price).gt(BigNumber.from(currentHighestInWei)) ||
              currentEndsAt < new Date().getTime()
            ) {
              emit("offer", {
                ...topOffer,
                watchers,
                collectionFloor,
                price: etherUtils.formatEther(price),
                buyer: signer,
                endsAt: endsAt * 1000,
                marketplace: "looksRare",
                collection,
                network: "eth",
                standard: "ERC-721",
              });
            }
          }
        )
    );
    const otherCollections = collectionEntries.slice(60);
    if (otherCollections.length > 0) {
      await sleep(POLL_COLLECTION_SLICE_DELAY);
      return pollCollectionOffers(collectionEntries.slice(60), emit);
    }

    return Promise.resolve();
  };

  const pollEvents = async () => {
    const alerts = await refreshAlertTokens();
    const { objects: currentOffers } = await dbClient.getAllCollectionOffers();
    const collectionMap = toCollectionMap(alerts, currentOffers);
    await updateCollectionFloors(collectionMap);
    await sleep(WAIT_BEFORE_LR_POLL_OFFERS);
    await pollCollectionOffers(Object.entries(collectionMap), handleOffer);
    await sleep(POLL_EVENTS_DELAY);
    pollEvents();
  };

  pollEvents();

  const eventEmitter = nftEventEmitter();
  ["acceptAsk", "acceptOffer", "settleAuction", "bid", "offer"].forEach(
    (saleType) => {
      eventEmitter.on(saleType, (args) => {
        try {
          handleSale({ ...args, saleType });
        } catch (error) {
          logError(
            `Error handling sale with args ${JSON.stringify({
              ...args,
              saleType,
            })}: ${error.toString()}`
          );
        }
      });
    }
  );
};

discordClient.once("ready", async () => {
  console.log(`Logged in as ${discordClient.user.tag}!`);
  const dbClient = await createDbClient();
  const nftClient = await createNFTClient();
  notifySales({ dbClient, nftClient });
  discordClient.on("interactionCreate", (interaction) => {
    handleInteraction({ discordClient, nftClient, dbClient }, interaction);
  });
});

discordClient.on("guildCreate", (guild) => {
  console.log(`Guild create event: ${guild.id}`);
  registerCommands(guild.id);
});
