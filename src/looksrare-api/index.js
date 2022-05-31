/*
 * Functions to interact with LooksRare's API
 */

import path from "path";
import dotenv from "dotenv";
import { utils as etherUtils } from "ethers";
import fetch from "node-fetch";
import sleep from "../sleep.js";

dotenv.config({ path: path.resolve(".env") });

const LR_COLLECTION_BID_STRATEGY_ADDRESS =
  "0x86f909f70813cdb1bc733f4d97dc6b03b8e7e8f3";
const LR_COLLECTION_STANDARD_SALE_FIXED_PRICE =
  "0x56244bb70cbd3ea9dc8007399f61dfc065190031";

/**
 * Calls a LooksRare endpoint with a limited number of retries.
 * @param  {String} endpoint - The endpoint to call.
 * @param  {Number} retries - The max. number of times to call
 * the endpoint.
 * @return {Array} result - The result of the call.
 */
const callLRWithRetries = (endpoint = "", retries = 1) =>
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
 * Get a collection's first N offers on LooksRare, sorted by price descending
 * (the highest offer will be the first in the returned array). See
 * https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders
 * for reference.
 * @param  {String} collection - The collection's Ethereum address.
 * @param  {Number} first - The number of offers to retrieve.
 * the endpoint.
 * @typedef LooksRareOffer - The LooksRare offer.
 * @param hash - The bid's hash.
 * @param price - The bid's amount in wei.
 * @param endTime - The timestamp for when the bid ends.
 * @param signer - The buyer's Ethereum address.
 * @return {Array[LooksRareOffer]} offers - The result of the call.
 */
export const getCollectionOffers = (collection, first = 1) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=false&collection=${collection}&strategy=${LR_COLLECTION_BID_STRATEGY_ADDRESS}&first=${first}&status[]=VALID&sort=PRICE_DESC`
  );

/**
 * Get a collection's floor price on LooksRare. See
 * https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders
 * for reference.
 * @param  {String} collection - The collection's Ethereum address.
 * @return {Number} floor - The collection's floor in Ether.
 */
export const getCollectionFloor = (collection) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=true&collection=${collection}&strategy=${LR_COLLECTION_STANDARD_SALE_FIXED_PRICE}&first=1&status[]=VALID&sort=PRICE_ASC`
  ).then((listings) => {
    if (listings.length === 0) {
      return null;
    }

    const [{ price }] = listings;
    return Number(etherUtils.formatEther(price));
  });
