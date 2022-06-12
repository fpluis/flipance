/* eslint-disable max-len */
/*
 * Functions to interact with LooksRare's API
 */

import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import sleep from "../sleep.js";

dotenv.config({ path: path.resolve(".env") });

const LR_COLLECTION_BID_STRATEGY_ADDRESS =
  "0x86f909f70813cdb1bc733f4d97dc6b03b8e7e8f3";
const LR_COLLECTION_STANDARD_SALE_FIXED_PRICE =
  "0x56244bb70cbd3ea9dc8007399f61dfc065190031";

const minutesAgo = (minutes = 2) =>
  new Date(new Date().setMinutes(new Date().getMinutes() - minutes));

/**
 * Calls a LooksRare endpoint with a limited number of retries.
 * @param  {String} endpoint - The endpoint to call.
 * @param  {Number} retries - The max. number of times to call
 * the endpoint.
 * @return {Array} result - The result of the call.
 */
const callLRWithRetries = (endpoint = "", retries = 3) =>
  fetch(endpoint)
    .then((res) => res.json())
    .then(async (response) => {
      const { data, message, success } = response;
      if (success === true) {
        return data;
      }

      if (message === "Too Many Requests" && retries > 0) {
        await sleep(Math.random() * 30 * 1000);
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
export const getCollectionOffers = ({ collection, first = 1 }) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=false&collection=${collection}&strategy=${LR_COLLECTION_BID_STRATEGY_ADDRESS}&pagination[first]=${first}&status[]=VALID&sort=PRICE_DESC`
  );

/**
 * Get a collection's floor order on LooksRare. See https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders for reference.
 * @param {Object} params - The query parameters
 * @param {String} params.collection - The collection's address.
 * @param {String} params.first - How many orders to retrieve, ordered by lowest asking price.
 * @return {Array[LooksRareOrder]} floor - The collection's floor order.
 */
export const getCollectionFloor = ({ collection, first = 1 }) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=true&collection=${collection}&strategy=${LR_COLLECTION_STANDARD_SALE_FIXED_PRICE}&pagination[first]=${first}&status[]=VALID&sort=PRICE_ASC`
  );

/**
 * Get a collection's latest listings on LooksRare. See https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders for reference.
 * @param {Object} params - The parameters object
 * @param {String} params.collection - The collection's address.
 * @param {Date} params.maxAge - The max age an listing can have.
 * @param {String} params.cursor - The hash of the oldest order, used to navigate the paginated response.
 * @return {Array[LooksRareOrder]}
 */
export const getCollectionListings = ({
  collection,
  maxAge = minutesAgo(2),
  first = 150,
  cursor = null,
}) => {
  let endpoint = `https://api.looksrare.org/api/v1/orders?isOrderAsk=true&collection=${collection}&strategy=${LR_COLLECTION_STANDARD_SALE_FIXED_PRICE}&pagination[first]=${first}&status[]=VALID&sort=NEWEST`;
  if (cursor) {
    endpoint = `${endpoint}&pagination[cursor]=${cursor}`;
  }

  return callLRWithRetries(endpoint).then(async (listings) => {
    const listingsBelowMaxAge = listings.filter(
      ({ startTime }) => new Date(startTime * 1000).getTime() > maxAge
    );
    if (listingsBelowMaxAge.length > 0) {
      const listingsByEarliestDate = listingsBelowMaxAge.sort(
        ({ startTime: startTime1 }, { startTime: startTime2 }) =>
          startTime2 - startTime1
      );
      const oldestListing =
        listingsByEarliestDate[listingsByEarliestDate.length - 1];
      const otherListings = await getCollectionListings({
        collection,
        maxAge,
        first,
        cursor: oldestListing.hash,
      });
      return listingsByEarliestDate.concat(otherListings);
    }

    return listingsBelowMaxAge;
  });
};
