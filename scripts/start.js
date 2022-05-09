/* eslint-disable no-await-in-loop */
import path from "path";
import dotenv from "dotenv";
import { Client, Intents } from "discord.js";
import {
  nftEventEmitter,
  calculateProfit,
  getAddressNFTs,
  pollCollectionOffers,
} from "../src/blockchain.js";
import logError from "../src/log-error.js";
import {
  handleInteraction,
  registerCommands,
  buildEmbed,
} from "../src/discord/index.js";
import sleep from "../src/sleep.js";
import moralisClient from "moralis/node.js";
import createDbClient from "../src/database/index.js";

dotenv.config({ path: path.resolve(".env") });

const {
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MORALIS_SERVER_URL,
  MORALIS_APP_ID,
  MORALIS_MASTER_KEY,
} = process.env;

const POLL_LR_BIDS_DELAY = 60 * 1000;
const POLL_USER_TOKENS_INTERVAL = 5 * 60 * 1000;

const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
const [, , testArg] = process.argv;
discordClient.login(
  testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
);

const isAllowedByUserPreferences = (
  { marketplace, saleType, collectionFloor, price },
  { allowedMarketplaces, allowedEvents, maxOfferFloorDifference }
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
    console.log(
      `Is price lower than the max offer floor difference? ${floorDifference}, ${maxOfferFloorDifference}, ${
        floorDifference < maxOfferFloorDifference
      }`
    );
    return floorDifference < maxOfferFloorDifference;
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

    const sellerWatchers = await dbClient.getAlertsByWallet(
      sellerAddress.toLowerCase()
    );
    if (sellerWatchers) {
      sellerWatchers
        .filter(({ settings }) => isAllowedByUserPreferences(args, settings))
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

    const buyerWatchers = await dbClient.getAlertsByWallet(
      buyerAddress.toLowerCase()
    );
    if (buyerWatchers) {
      buyerWatchers
        .filter(({ settings }) => isAllowedByUserPreferences(args, settings))
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

    const collectionWatchers = await dbClient.getAlertsByWallet(
      collectionAddress.toLowerCase()
    );
    if (collectionWatchers) {
      collectionWatchers.forEach(async ({ channelId }) => {
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

  const handleOffer = async (bidType, args) => {
    const { watchers, collection, price, endTime } = args;
    await dbClient.setCollectionOffer({
      address: collection,
      price,
      endTime: endTime * 1000,
    });
    const users = await dbClient.getUsers(watchers.map(({ userId }) => userId));
    watchers.forEach(async ({ userId, tokenIds }) => {
      const user = users.find(({ userId: userId1 }) => userId === userId1);
      if (isAllowedByUserPreferences(args, user)) {
        try {
          const discordUser = await discordClient.users.fetch(userId);
          const embed = await buildEmbed({ args, saleType: bidType, tokenIds });
          discordUser.send(embed).catch((error) => {
            logError(
              `Error sending bid notification to user ${userId}; Error: ${error.toString()}`
            );
          });
        } catch (error) {
          console.log(
            `Error handling bid with args ${JSON.stringify({
              ...args,
            })}: ${error.toString()}`
          );
        }
      }
    });
  };

  const listenToNftBids = async () => {
    const users = await dbClient.getAllUsers();
    const collectionMap = Object.entries(users).reduce(
      (collectionMap, [userId, { tokens }]) => {
        const userCollections = tokens.reduce((collections, token) => {
          const [collection, tokenId] = token.split("/");
          const tokenIds = collections[collection] || [];
          collections[collection] = tokenIds.concat(tokenId);
          return collections;
        }, {});
        Object.entries(userCollections).forEach(([collection, tokenIds]) => {
          const { currentWatchers = [] } = collectionMap[collection] || {};
          // const { price, endTime } = collectionBids[collection] || {
          //   price: "0",
          //   endTime: new Date("1970-01-01").getTime(),
          // };
          collectionMap[collection] = {
            watchers: currentWatchers.concat([{ userId, tokenIds }]),
          };
        });
        return collectionMap;
      },
      {}
    );
    const currentOffers = await dbClient.getAllOffers(
      Object.keys(collectionMap)
    );
    currentOffers.forEach(({ collection, price, endTime }) => {
      collection[collection].price = price;
      collection[collection].endTime = endTime;
    });
    await pollCollectionOffers(Object.entries(collectionMap), handleOffer);
    await sleep(POLL_LR_BIDS_DELAY);
    listenToNftBids(dbClient);
  };

  listenToNftBids();

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

const pollUserTokens = async (dbClient) => {
  let index = 0;
  const users = await dbClient.getAllUsers();
  const entries = Object.entries(users);
  while (index < entries) {
    const [id, { addresses, syncedAt }] = entries[index];
    if (
      syncedAt == null ||
      new Date() - new Date(syncedAt) > POLL_USER_TOKENS_INTERVAL
    ) {
      const tokens = await getAddressNFTs(moralisClient, addresses);
      await dbClient.setUserTokens({ id, tokens });
    }

    index += 1;
  }

  await sleep(POLL_USER_TOKENS_INTERVAL);
  pollUserTokens(dbClient);
};

discordClient.once("ready", async () => {
  console.log(`Logged in as ${discordClient.user.tag}!`);
  const dbClient = await createDbClient();
  notifySales({ discordClient, dbClient });
  await moralisClient.start({
    serverUrl: MORALIS_SERVER_URL,
    appId: MORALIS_APP_ID,
    masterKey: MORALIS_MASTER_KEY,
  });
  discordClient.on("interactionCreate", (interaction) => {
    handleInteraction({ discordClient, moralisClient, dbClient }, interaction);
  });
  pollUserTokens(dbClient);
});

discordClient.on("guildCreate", (guild) => {
  console.log(`Guild create event: ${guild.id}`);
  registerCommands(guild.id);
});
