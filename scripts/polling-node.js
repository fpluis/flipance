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
import sleep from "../src/sleep.js";

dotenv.config({ path: path.resolve(".env") });

const {
  ETHERSCAN_API_KEY,
  INFURA_PROJECT_ID,
  POCKET_PROJECT_ID,
  POCKET_SECRET_KEY,
  ALCHEMY_API_KEY,
  ETHEREUM_NETWORK = "homestead",
} = process.env;

// const CHECK_POLLED_COLLECTIONS_PERIOD = 1 * 60 * 1000;
const UPDATE_ALERT_TOKENS_DELAY = 5 * 60 * 1000;

const ethProvider = getDefaultProvider(ETHEREUM_NETWORK, {
  etherscan: ETHERSCAN_API_KEY,
  infura: INFURA_PROJECT_ID,
  pocket: {
    applicationId: POCKET_PROJECT_ID,
    applicationSecretKey: POCKET_SECRET_KEY,
  },
  alchemy: ALCHEMY_API_KEY,
});

/**
 *
 * Given a price and a floor, computes the floor difference such that it
 * fits a maximum and a minimum.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {void}
 */
const computeFloorDifference = (
  price,
  floor,
  lowerBound = -(10 ** 9),
  upperBound = 10 ** 9
) => {
  if (floor === 0) {
    return 1;
  }

  if (price === 0) {
    return -1;
  }

  const difference = (price - floor) / floor;
  return difference < lowerBound
    ? lowerBound
    : difference > upperBound
    ? upperBound
    : difference;
};

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
          new Date() - new Date(syncedAt) > UPDATE_ALERT_TOKENS_DELAY)
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

  const alertsToCollections = (alerts) => {
    const collectionMap = alerts.reduce((collectionMap, { tokens }) => {
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
    const {
      collection,
      marketplace,
      price,
      tokenId,
      endsAt,
      hash: orderHash,
      // Offers polled from specific collections are always the current
      // highest offer.
      isHighestOffer: offerMustBeHighest = false,
    } = event;
    let isHighestOffer = offerMustBeHighest;
    const { object: currentOffer } = await dbClient.getOffer({
      collection,
      tokenId,
    });

    const {
      endsAt: currentOfferEndsAt = new Date("1970-01-01"),
      price: currentOfferPrice = 0,
    } = currentOffer || {};
    if (
      isHighestOffer ||
      price > currentOfferPrice ||
      currentOfferEndsAt < new Date().getTime()
    ) {
      logMessage({
        message: "Setting new highest offer on DB",
        currentOffer,
        collection,
        tokenId,
        wasPolledSpecifically: isHighestOffer,
        price,
        level: "debug",
      });
      isHighestOffer = true;
      await dbClient.setOffer({
        collection,
        price,
        endsAt,
        marketplace,
        tokenId,
      });
    }

    return dbClient.addNFTEvent({
      ...event,
      orderHash,
      isHighestOffer,
      collectionFloor,
      floorDifference: computeFloorDifference(price, collectionFloor),
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
      (isNewFloor && endsAt !== currentEndsAt && price !== collectionFloor) ||
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
      floorDifference: computeFloorDifference(price, collectionFloor),
    });
  };

  const handleNFTEvent = async (event) => {
    const { eventType, collection, price } = event;
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
      collectionFloor,
      floorDifference: computeFloorDifference(price, collectionFloor),
    });
  };

  const pollAlertTokens = async () => {
    const { objects: alerts } = await dbClient.getAllAlerts();
    const collections = alertsToCollections(alerts);
    nftEventEmitter.setCollectionsToPoll(collections);
    await updateAlertTokens(alerts);
    await sleep(UPDATE_ALERT_TOKENS_DELAY);
    return pollAlertTokens();
  };

  nftEventEmitter.start();
  pollAlertTokens(nftEventEmitter);
  nftEventEmitter.on("event", handleNFTEvent);
};

const start = async () => {
  logMessage({ message: `Starting polling node`, level: "info" });
  const dbClient = await createDbClient();
  const nftClient = await createNFTClient();
  const nftEventEmitter = createNFTEventEmitter(ethProvider, []);
  monitorBlockchainEvents({ dbClient, nftClient, nftEventEmitter });
};

start();

process.on("unhandledRejection", (error) => {
  logMessage({
    message: `Unhandled promise rejection`,
    level: "error",
    error,
  });
  process.exit(-1);
});

process.on("uncaughtException", (error) => {
  logMessage({ message: `Uncaught exception`, level: "error", error });
  process.exit(-1);
});
