/* eslint-disable require-atomic-updates */
/* eslint-disable no-await-in-loop */

/// <reference path="../src/typedefs.js" />

/*
 * This script is in charge of polling blockchain events and storing them in the database. Only one instance of this process should be running at any given moment.
 */

import path from "path";
import dotenv from "dotenv";
import {
  nftEventEmitter as createNFTEventEmitter,
  createNFTClient,
} from "../src/blockchain/index.js";
// eslint-disable-next-line no-unused-vars
import EventEmitter from "events";
import logMessage from "../src/log-message.js";
import { createDbClient } from "../src/database/index.js";
import { getDefaultProvider, utils as etherUtils } from "ethers";
import sleep from "../src/sleep.js";
import {
  getCollectionFloor,
  getHighestOffers,
} from "../src/looksrare-api/index.js";

dotenv.config({ path: path.resolve(".env") });

const {
  ETHERSCAN_API_KEY,
  INFURA_PROJECT_ID,
  POCKET_PROJECT_ID,
  POCKET_SECRET_KEY,
  ALCHEMY_API_KEY,
  ETHEREUM_NETWORK = "homestead",
} = process.env;

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
 * Given a price and a floor, computes the floor difference such that it fits a maximum and a minimum.
 * @param {Number} price The price in the blockchain's native currency.
 * @param {Number} floor The floor price in the blockchain's native currency.
 * @param {Number} lowerBound (Optional) The minimum value this function can return.
 * @param {Number} upperBound (Optional) The maximum value this function can return.
 * @return {Number}
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
 * This function takes as parameter already-configured clients and sets up NFT event monitoring on the target marketplaces.
 * @param {Object} params
 * @param {Object} params.dbClient - The initialized database client.
 * @param {Object} params.nftClient - The initialized client to fetch the NFTs owned by a specific address.
 * @param {EventEmitter} params.nftEventEmitter - The initialized client to poll NFT events.
 */
const monitorBlockchainEvents = async ({
  dbClient,
  nftClient,
  nftEventEmitter,
}) => {
  /**
   * Updates the tokens associated to an alert to always monitor the offers for collections that users own.
   * @param {Object[]} alerts - The alert objects on which to update the tokens
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

  /**
   * Reduces the alerts to the set of collections that at least one alert is watching.
   * @param {Alert[]} alerts - The alert objects on which to update the tokens
   * @return {String[]} collections - The collection addresses.
   */
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

  /**
   * Handles an NFT "offer" event.
   * @param {NFTEvent} event
   * @return {String[]} collections - The collection addresses.
   */
  const handleOffer = async (event, { price: collectionFloor = 0 } = {}) => {
    const {
      collection,
      marketplace,
      price,
      tokenId,
      endsAt,
      orderHash,
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
      isHighestOffer = true;
      await dbClient.setOffer({
        collection,
        orderHash,
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

  /**
   * Handles a collection listing event generated by the nft event emitter.
   * @param {NFTEvent} event
   * @param {CollectionFloor} floor
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
      orderHash,
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
        orderHash,
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

  /**
   * Forces an update on the collection's floor to whatever is the minimum current listing.
   * @param {Object} params - The params object.
   * @param {String} params.collection - The collection to update.
   */
  const forceFloorUpdate = async ({ collection }) => {
    const newFloorListings = await getCollectionFloor({ collection });
    if (newFloorListings.length > 0) {
      const [{ price, endTime: endsAt, hash: newFloorHash }] = newFloorListings;
      await dbClient.setCollectionFloor({
        collection,
        orderHash: newFloorHash,
        price: Number(etherUtils.formatEther(price)),
        endsAt: new Date(endsAt * 1000),
        // This should be updated when offers/listings
        // are pulled from other marketplaces
        marketplace: "looksRare",
      });
      // If there are no listings, set the floor to 0
    } else {
      await dbClient.setCollectionFloor({
        collection,
        orderHash: null,
        price: 0,
        endsAt: new Date("1970-01-01"),
        // This should be updated when offers/listings
        // are pulled from other marketplaces
        marketplace: "looksRare",
      });
    }
  };

  /**
   * Forces an update on a collection or token to whatever is the highest current offer for that collection or token.
   * @param {Object} params - The params object.
   * @param {String} params.collection - The collection to update.
   * @param {String|null} params.collection - The id of the token to update.
   */
  const forceOfferUpdate = async ({ collection, tokenId }) => {
    const newOffers = await getHighestOffers({ collection, tokenId });
    if (newOffers.length > 0) {
      const [{ price, endTime: endsAt, hash: orderHash }] = newOffers;
      await dbClient.setOffer({
        collection,
        tokenId,
        orderHash,
        price: Number(etherUtils.formatEther(price)),
        endsAt: new Date(endsAt * 1000),
        // This should be updated when offers/listings
        // are pulled from other marketplaces
        marketplace: "looksRare",
      });
      // If there are no offers, set the highest offer to 0
    } else {
      await dbClient.setOffer({
        collection,
        tokenId,
        orderHash: null,
        price: 0,
        endsAt: new Date("1970-01-01"),
        // This should be updated when offers/listings
        // are pulled from other marketplaces
        marketplace: "looksRare",
      });
    }
  };

  /**
   * Handles an accept offer event generated by the nft event emitter.
   * @param {NFTEvent} event
   * @param {CollectionFloor} floor
   */
  const handleAcceptOffer = async (
    event,
    { price: collectionFloor = 0 } = {}
  ) => {
    const { collection, marketplace, price, orderHash, tokenId } = event;
    const { object: currentOffer } = await dbClient.getOffer({
      collection,
      tokenId,
    });
    if (currentOffer != null && orderHash === currentOffer.orderHash) {
      await forceOfferUpdate({ collection, tokenId, marketplace });
    }

    return dbClient.addNFTEvent({
      ...event,
      collectionFloor,
      floorDifference: computeFloorDifference(price, collectionFloor),
    });
  };

  /**
   * Handles an accept offer event generated by the nft event emitter.
   * @param {NFTEvent} event
   * @param {CollectionFloor} floor
   */
  const handleAcceptAsk = async (
    event,
    { price: collectionFloor = 0, orderHash: floorHash } = {}
  ) => {
    const { collection, price, orderHash } = event;
    if (orderHash === floorHash) {
      await forceFloorUpdate({
        collection,
      });
    }

    return dbClient.addNFTEvent({
      ...event,
      collectionFloor,
      floorDifference: computeFloorDifference(price, collectionFloor),
    });
  };

  /**
   * Handles an accept offer event generated by the nft event emitter.
   * @param {NFTEvent} event
   * @param {CollectionFloor} floor
   */
  const handleCancelOrder = async (event, currentFloor) => {
    const { price: collectionFloor = 0, orderHash: floorHash } =
      currentFloor || {};
    const { collection, marketplace, price, orderHash, tokenId } = event;
    if (orderHash === floorHash) {
      await forceFloorUpdate({
        collection,
      });
      return dbClient.addNFTEvent({
        ...event,
        collectionFloor,
        floorDifference: computeFloorDifference(price, collectionFloor),
      });
    }

    const { object: currentOffer } = await dbClient.getOffer({
      collection,
      tokenId,
    });
    if (currentOffer != null && orderHash === currentOffer.orderHash) {
      await forceOfferUpdate({
        collection,
        tokenId,
        marketplace,
      });
    }

    return dbClient.addNFTEvent({
      ...event,
      collectionFloor,
      floorDifference: computeFloorDifference(price, collectionFloor),
    });
  };

  /**
   * Handles an NFT event coming from the NFT event emitter.
   * @param {NFTEvent}
   */
  const handleNFTEvent = async (event) => {
    const { eventType, collection, price } = event;
    const { object: floorObject } = await dbClient.getCollectionFloor({
      collection,
    });
    const floor = floorObject || {};
    const { price: collectionFloor = 0 } = floor;
    switch (eventType) {
      case "offer":
        return handleOffer(event, floor);
      case "listing":
        return handleListing(event, floor);
      case "acceptOffer":
        return handleAcceptOffer(event, floor);
      case "acceptAsk":
        return handleAcceptAsk(event, floor);
      case "cancelOrder":
        return handleCancelOrder(event, floor);
      default:
        return dbClient.addNFTEvent({
          ...event,
          collectionFloor,
          floorDifference: computeFloorDifference(price, collectionFloor),
        });
    }
  };

  /**
   * Periodically fetches the current alerts from the database, retrieves the tokens currently held by the addresses the alerts are watching, and updates the NFT event emitter to only retrieve marketplaces orders from those collections.
   * @param {NFTEvent} event
   * @param {CollectionFloor} floor
   */
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
