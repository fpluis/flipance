/* eslint-disable max-len */
/*
 * Functions to interact with LooksRare's API
 */

import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import sleep from "../sleep.js";
import logMessage from "../log-message.js";

dotenv.config({ path: path.resolve(".env") });

const { ETHEREUM_NETWORK = "homestead", LOOKSRARE_API_KEY } = process.env;

const LR_COLLECTION_BID_STRATEGY_ADDRESS =
  ETHEREUM_NETWORK === "homestead"
    ? "0x86f909f70813cdb1bc733f4d97dc6b03b8e7e8f3"
    : "0xa6e7decd4e18b510c6b98aa0c8ee2db3879f529d";
const LR_COLLECTION_STANDARD_SALE_FIXED_PRICE =
  ETHEREUM_NETWORK === "homestead"
    ? "0x56244bb70cbd3ea9dc8007399f61dfc065190031"
    : "0x732319A3590E4fA838C111826f9584a9A2fDEa1a";
const looksRareAPI =
  ETHEREUM_NETWORK === "homestead"
    ? `https://api.looksrare.org`
    : `https://api-rinkeby.looksrare.org`;

/**
 * Calls a LooksRare endpoint with a limited number of retries.
 * @param  {String} endpoint - The endpoint to call.
 * @param  {Number} retries - The max. number of times to call
 * the endpoint.
 * @return {Array} result - The result of the call.
 */
const callLRWithRetries = (endpoint = "", retries = 3) => {
  const options = {};
  if (LOOKSRARE_API_KEY) {
    options["X-Looks-Api-Key"] = LOOKSRARE_API_KEY;
  }

  return fetch(endpoint, options)
    .then((res) => res.json())
    .then(async (response) => {
      const { data, message, success } = response;
      if (success === true) {
        return data;
      }

      if (message === "Too Many Requests" && retries > 0) {
        logMessage({
          message: `LooksRare API rate limits exceeded. Delaying the next request`,
          response,
          level: "warning",
        });
        await sleep(Math.random() * 5 * 1000);
        return callLRWithRetries(endpoint, retries - 1);
      }

      return [];
    })
    .catch(async (error) => {
      if (["ETIMEDOUT", "ECONNRESET"].includes(error.code) && retries > 0) {
        await sleep(Math.random() * 30 * 1000);
        return callLRWithRetries(endpoint, retries - 1);
      }

      return [];
    });
};

/**
 * Get a collection's first N offers on LooksRare, sorted by price descending (the highest offer will be the first in the returned array). See https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders for reference.
 * @param {Object} params - The query parameters
 * @param {String} params.collection - The collection's address.
 * @param {String} params.first - How many orders to retrieve, ordered by highest offer price.
 * @typedef LooksRareOrder - The LooksRare offer.
 * @param {String} hash - The bid's hash.
 * @param {String} price - The bid's amount in wei.
 * @param {Number} endTime - The timestamp for when the bid ends.
 * @param {String} signer - The buyer's Ethereum address.
 * @param tokenId
 * @return {Array[LooksRareOrder]} offers - The result of the call.
 */
export const getHighestOffers = ({ collection, tokenId, first = 1 }) => {
  let endpoint = `${looksRareAPI}/api/v1/orders?isOrderAsk=false&collection=${collection}&strategy=${LR_COLLECTION_BID_STRATEGY_ADDRESS}&pagination[first]=${first}&status[]=VALID&sort=PRICE_DESC`;
  if (tokenId) {
    logMessage({
      message: `Get highest offers for tokenId ${tokenId}`,
      collection,
      tokenId,
    });
    endpoint = `${endpoint}&tokenId=${tokenId}`;
  }

  return callLRWithRetries(endpoint);
};

/**
 * Get a collection's floor order on LooksRare. See https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders for reference.
 * @param {Object} params - The query parameters
 * @param {String} params.collection - The collection's address.
 * @param {String} params.first - How many orders to retrieve, ordered by lowest asking price.
 * @return {Array[LooksRareOrder]} floor - The collection's floor order.
 */
export const getCollectionFloor = ({ collection, first = 1 }) =>
  callLRWithRetries(
    `${looksRareAPI}/api/v1/orders?isOrderAsk=true&collection=${collection}&strategy=${LR_COLLECTION_STANDARD_SALE_FIXED_PRICE}&pagination[first]=${first}&status[]=VALID&sort=PRICE_ASC`
  );

export const getEvents = ({ cursor = null, type = "LIST" }) => {
  let endpoint = `${looksRareAPI}/api/v1/events?type=${type}&pagination[first]=150`;
  if (cursor) {
    endpoint = `${endpoint}&pagination[cursor]=${cursor}`;
  }

  return callLRWithRetries(endpoint);
};
