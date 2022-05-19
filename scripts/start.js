/* eslint-disable no-await-in-loop */
import path from "path";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { Client, Intents } from "discord.js";
import {
  nftEventEmitter,
  calculateProfit,
  getAddressNFTs,
  pollCollectionOffers,
  getCollectionFloor,
} from "../src/blockchain/index.js";
import logError from "../src/log-error.js";
import {
  handleInteraction,
  registerCommands,
  buildEmbed,
} from "../src/discord/index.js";
import sleep from "../src/sleep.js";
import moralisClient from "moralis/node.js";
import { createDbClient } from "../src/database/index.js";

dotenv.config({ path: path.resolve(".env") });

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const {
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MORALIS_SERVER_URL,
  MORALIS_APP_ID,
  MORALIS_MASTER_KEY,
  MAX_OFFER_FLOOR_DIFFERENCE,
} = process.env;

const WAIT_BEFORE_LR_POLL_OFFERS = 60 * 1000;
const POLL_EVENTS_DELAY = 60 * 1000;
const POLL_USER_TOKENS_INTERVAL = 5 * 60 * 1000;

const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
const [, , testArg] = process.argv;
discordClient.login(
  testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
);

if (testArg === "test") {
  console.log(`Starting the client in TEST mode`);
}

const isAllowedByUserPreferences = (
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

const notifySales = async ({ discordClient, dbClient }) => {
  const handleSale = async (args) => {
    const {
      seller: sellerAddress = "",
      buyer: buyerAddress = "",
      collection: collectionAddress = "",
    } = args;

    const { objects: sellerAlerts } = await dbClient.getAlertsByAddress({
      address: sellerAddress.toLowerCase(),
    });
    if (sellerAlerts) {
      sellerAlerts
        .filter((alert) => isAllowedByUserPreferences(args, alert))
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
    if (buyerAlerts) {
      buyerAlerts
        .filter((buyer) => isAllowedByUserPreferences(args, buyer))
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
    if (collectionAlerts) {
      collectionAlerts.forEach(async ({ channelId }) => {
        if (channelId == null) {
          return;
        }

        try {
          const channel = await discordClient.channels.fetch(channelId);
          const embed = await buildEmbed(args);
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
    const { watchers, collection, price, endsAt } = args;
    args.saleType = saleType;
    await dbClient.setCollectionOffer({
      address: collection,
      price,
      endsAt,
    });
    watchers.forEach(async (watcher) => {
      const { discordId, channelId, tokenIds, settings } = watcher;
      if (isAllowedByUserPreferences(args, settings)) {
        try {
          const target = await (channelId == null
            ? discordClient.users.fetch(discordId)
            : discordClient.channels.fetch(channelId));
          const embed = await buildEmbed({
            ...args,
            target: channelId == null ? "user" : "server",
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
    while (index < alerts) {
      const [{ id, address, syncedAt }] = alerts[index];
      if (
        syncedAt == null ||
        new Date() - new Date(syncedAt) > POLL_USER_TOKENS_INTERVAL
      ) {
        const tokens = await getAddressNFTs(moralisClient, address);
        await dbClient.setAlertTokens({ id, tokens });
        alerts[index].tokens = tokens;
      }

      index += 1;
    }

    return alerts;
  };

  const toCollectionMap = (alerts, offers) => {
    const collectionMap = alerts.reduce(
      (collectionMap, { id, tokens, discordId, channelId, ...settings }) => {
        const userCollections = tokens.reduce((collections, token) => {
          const [collection, tokenId] = token.split("/");
          const tokenIds = collections[collection] || [];
          collections[collection] = tokenIds.concat(tokenId);
          return collections;
        }, {});
        Object.entries(userCollections).forEach(([collection, tokenIds]) => {
          const { watchers: currentWatchers = [] } =
            collectionMap[collection] || {};
          collectionMap[collection] = {
            watchers: currentWatchers.concat([
              { id, tokenIds, discordId, channelId, settings },
            ]),
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
  notifySales({ discordClient, dbClient });
  await moralisClient
    .start({
      serverUrl: MORALIS_SERVER_URL,
      appId: MORALIS_APP_ID,
      masterKey: MORALIS_MASTER_KEY,
    })
    .catch(() => {
      console.log(`Invalid/missing Moralis credentials. Starting without it`);
    });
  discordClient.on("interactionCreate", (interaction) => {
    handleInteraction({ discordClient, moralisClient, dbClient }, interaction);
  });
});

discordClient.on("guildCreate", (guild) => {
  console.log(`Guild create event: ${guild.id}`);
  registerCommands(guild.id);
});
