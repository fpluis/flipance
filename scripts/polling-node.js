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
import logMessage from "../src/log-message.js";
import { createDbClient } from "../src/database/index.js";
import { getDefaultProvider } from "ethers";

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
// const POLLS_PER_RESET = 10;

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

  const getCollectionsToPoll = async () => {
    const { objects: alerts } = await dbClient.getAllAlerts();
    const updatedAlerts = await updateAlertTokens(alerts);
    const collectionMap = updatedAlerts.reduce((collectionMap, { tokens }) => {
      tokens.forEach((token) => {
        const [collection] = token.split("/");
        if (collectionMap[collection] == null) {
          collectionMap[collection] = true;
        }
      }, {});
      return collectionMap;
    }, {});
    return Object.keys(collectionMap);
  };

  const handleOffer = async (event, { price: collectionFloor = 0 } = {}) => {
    const { collection, marketplace, price, endsAt } = event;
    const { object: currentOffer } = await dbClient.getCollectionOffer({
      collection,
    });
    const {
      endsAt: currentOfferEndsAt = new Date("1970-01-01"),
      price: currentOfferPrice = 0,
    } = currentOffer || {};
    let isHighestOffer = false;
    if (
      price > currentOfferPrice ||
      currentOfferEndsAt < new Date().getTime()
    ) {
      isHighestOffer = true;
      await dbClient.setCollectionOffer({
        collection,
        price,
        endsAt,
        marketplace,
      });
    }

    return dbClient.addNFTEvent({
      ...event,
      isHighestOffer,
      collectionFloor,
      floorDifference: price === 0 ? 1 : (price - collectionFloor) / price,
    });
  };

  /*
   * Handles a collection listing event generated by the nft event emitter.
   */
  const handleListing = async (
    event,
    {
      price: collectionFloor = 0,
      endsAt: currentEndsAt = new Date("1970-01-01"),
    } = {}
  ) => {
    const {
      collection,
      marketplace,
      price,
      endsAt,
      hash: orderHash,
      isNewFloor = false,
    } = event;
    if (
      isNewFloor ||
      collectionFloor === 0 ||
      price < collectionFloor ||
      currentEndsAt < new Date().getTime()
    ) {
      await dbClient.setCollectionFloor({
        collection,
        price,
        endsAt,
        marketplace,
      });
    }

    return dbClient.addNFTEvent({
      ...event,
      orderHash,
      collectionFloor,
      floorDifference: price === 0 ? 1 : (price - collectionFloor) / price,
    });
  };

  const handleNFTEvent = async (event) => {
    const { eventType, collection, price, hash: orderHash } = event;
    if (eventType === "cancelOrder") {
      return dbClient.addNFTEvent(event);
    }

    const { object: floorObject } = await dbClient.getCollectionFloor({
      collection,
    });
    const floor = floorObject || {};
    const { price: collectionFloor = 0 } = floor;
    if (eventType === "offer") {
      return handleOffer(event, floor);
    }

    if (eventType === "listing") {
      return handleListing(event, floor);
    }

    return dbClient.addNFTEvent({
      ...event,
      orderHash,
      collectionFloor,
      floorDifference: price === 0 ? 1 : (price - collectionFloor) / price,
    });
  };

  const collections = await getCollectionsToPoll();
  nftEventEmitter.poll(collections);
  nftEventEmitter.start();
  nftEventEmitter.on("event", handleNFTEvent);
  nftEventEmitter.on("pollEnded", async () => {
    console.log(`Polling ended`);
    nftEventEmitter.stop();
    monitorBlockchainEvents({
      dbClient,
      nftClient,
      nftEventEmitter,
    });
  });
};

const start = async () => {
  console.log(`Starting polling node`);
  const dbClient = await createDbClient();
  const nftClient = await createNFTClient();
  const nftEventEmitter = createNFTEventEmitter(ethProvider, []);
  monitorBlockchainEvents({ dbClient, nftClient, nftEventEmitter });
};

start();

process.on("unhandledRejection", (error) => {
  console.log(error);
  logMessage(`Unhandled promise rejection: ${error.toString()}`, "error");
  process.exit(-1);
});

process.on("uncaughtException", (error) => {
  console.log(error);
  logMessage(`Uncaught exception: ${error.toString()}`, "error");
  process.exit(-1);
});
