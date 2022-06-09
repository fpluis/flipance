/* eslint-disable require-atomic-updates */
/* eslint-disable no-await-in-loop */

/*
 * This is the main script to run the Flipance bot. It coordinates all the
different modules, polling offers, collection floors and user's tokens and also
listens to blockchain events.
 */

import path from "path";
import dotenv from "dotenv";
import {
  nftEventEmitter as createNFTEventEmitter,
  createNFTClient,
} from "../src/blockchain/index.js";
import logError from "../src/log-error.js";
import { createDbClient } from "../src/database/index.js";
import { getDefaultProvider } from "ethers";
import createBotClient from "../src/discord/create-bot-client.js";

dotenv.config({ path: path.resolve(".env") });

const {
  ETHERSCAN_API_KEY,
  INFURA_PROJECT_ID,
  POCKET_PROJECT_ID,
  POCKET_SECRET_KEY,
  ALCHEMY_API_KEY,
} = process.env;

const POLL_USER_TOKENS_INTERVAL = 5 * 60 * 1000;

/*
 * Every "N" NFT polls, the Discord client is reset to make sure
 * it doesn't die silently.
 */
const POLLS_PER_RESET = 10;

const ethProvider = getDefaultProvider("homestead", {
  etherscan: ETHERSCAN_API_KEY,
  infura: INFURA_PROJECT_ID,
  pocket: {
    applicationId: POCKET_PROJECT_ID,
    applicationSecretKey: POCKET_SECRET_KEY,
  },
  alchemy: ALCHEMY_API_KEY,
});

/**
 * This function takes as parameter already-configured clients and is in
 * charge of monitoring blockchain events on the target marketplaces and
 * notifying users/servers of these events.
 * @param {Object} params
 * @param {Object} params.dbClient - The initialized database client.
 * @param {Object} params.nftClient - The initialized client to poll NFT
 */
const monitorBlockchainEvents = async ({
  dbClient,
  nftClient,
  nftEventEmitter,
}) => {
  /*
   * Updates the tokens associated to an alert to always monitor the
   * offers for collections that users own.
   */
  const updateAlertTokens = async (alerts) => {
    let index = 0;
    while (index < alerts.length) {
      const { id, address, type, syncedAt } = alerts[index];
      if (
        type === "wallet" &&
        (syncedAt == null ||
          new Date() - new Date(syncedAt) > POLL_USER_TOKENS_INTERVAL)
      ) {
        const tokens = await nftClient.getAddressNFTs(address);
        alerts[index].tokens = tokens;
        alerts[index].syncedAt = new Date();
        await dbClient.setAlertTokens({ id, tokens });
      }

      index += 1;
    }

    return alerts;
  };

  /*
   * Creates a map where each collection address has associated a list of
   * watchers (users and servers) and their token ids.
   * The purpose of this map is to pull information only for the collections
   * which are relevant to users.
   */
  const createCollectionMap = async () => {
    const { objects: alerts } = await dbClient.getAllAlerts();
    const updatedAlerts = await updateAlertTokens(alerts);
    const collectionMap = updatedAlerts.reduce(
      (collectionMap, { id, tokens, ...alert }) => {
        const userCollections = tokens.reduce((collections, token) => {
          const [collection, tokenId] = token.split("/");
          const currentIds = collections[collection] || [];
          collections[collection] =
            tokenId.length > 0 ? currentIds.concat(tokenId) : currentIds;
          return collections;
        }, {});
        Object.entries(userCollections).forEach(([collection, tokenIds]) => {
          const { watchers: currentWatchers = [] } =
            collectionMap[collection] || {};
          collectionMap[collection] = {
            watchers: currentWatchers.concat([{ ...alert, id, tokenIds }]),
          };
        });
        return collectionMap;
      },
      {}
    );

    return collectionMap;
  };

  const collectionMap = await createCollectionMap();
  const collections = Object.keys(collectionMap);
  const botClient = await createBotClient({
    dbClient,
    nftClient,
  });
  nftEventEmitter.poll(collections);
  nftEventEmitter.start();
  nftEventEmitter.on("event", (event) => {
    const entry =
      event.collection == null
        ? {}
        : collectionMap[event.collection.toLowerCase()];
    const { watchers = [] } = entry || {};
    botClient.emit("nftEvent", { ...event, watchers });
  });
  let currentPolls = 0;
  nftEventEmitter.on("pollEnded", () => {
    if (currentPolls < POLLS_PER_RESET) {
      currentPolls += 1;
      nftEventEmitter.poll();
    } else {
      nftEventEmitter.stop();
      botClient.destroy();
      monitorBlockchainEvents({
        dbClient,
        nftClient,
        nftEventEmitter,
      });
    }
  });
};

const start = async () => {
  const dbClient = await createDbClient();
  const nftClient = await createNFTClient();
  const nftEventEmitter = createNFTEventEmitter(ethProvider, []);
  monitorBlockchainEvents({ dbClient, nftClient, nftEventEmitter });
};

start();

process.on("unhandledRejection", (error) => {
  console.log(error);
  logError(`Unhandled promise rejection: ${error.toString()}`);
  process.exit(-1);
});

process.on("uncaughtException", (error) => {
  console.log(error);
});
