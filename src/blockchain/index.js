import path from "path";
import dotenv from "dotenv";
import { utils as etherUtils, BigNumber } from "ethers";
import fetch from "node-fetch";
import sleep from "../sleep.js";
import createNFTClient from "./create-nft-client.js";
import getCollectionMetadata from "./get-collection-metadata.js";
import calculateProfit from "./calculate-profit.js";
import nftEventEmitter from "./nft-event-emitter.js";

export {
  createNFTClient,
  getCollectionMetadata,
  calculateProfit,
  nftEventEmitter,
};

dotenv.config({ path: path.resolve(".env") });

const LR_COLLECTION_BID_STRATEGY_ADDRESS =
  "0x86f909f70813cdb1bc733f4d97dc6b03b8e7e8f3";
const LR_COLLECTION_STANDARD_SALE_FIXED_PRICE =
  "0x56244bb70cbd3ea9dc8007399f61dfc065190031";
const POLL_COLLECTION_SLICE_DELAY = 60 * 1000;

const callLRWithRetries = (endpoint, retries = 1) =>
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

const getCollectionOffers = (collection) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=false&collection=${collection}&strategy=${LR_COLLECTION_BID_STRATEGY_ADDRESS}&first=1&status[]=VALID&sort=PRICE_DESC`
  );

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

export const pollCollectionOffers = async (
  collections,
  emit,
  currentOffers = []
) => {
  const offers = await Promise.all(
    collections
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
          const { hash, price, endTime: endsAt, signer } = topOffer;
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
              bidHash: hash,
              marketplace: "looksRare",
              collection,
              network: "eth",
              standard: "ERC-721",
            });
          }
        }
      )
  );
  const newOffers = currentOffers.concat(offers);
  const otherCollections = collections.slice(60);
  if (otherCollections.length > 0) {
    await sleep(POLL_COLLECTION_SLICE_DELAY);
    return pollCollectionOffers(collections.slice(60), emit, newOffers);
  }

  return newOffers;
};
