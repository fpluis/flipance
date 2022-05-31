import path from "path";
import dotenv from "dotenv";
import { utils as etherUtils, getDefaultProvider, BigNumber } from "ethers";
import fetch from "node-fetch";
import sleep from "../sleep.js";

dotenv.config({ path: path.resolve(".env") });

const MAX_GET_COLLECTION_RETRIES = 3;

const {
  ETHERSCAN_API_KEY,
  INFURA_PROJECT_ID,
  POCKET_PROJECT_ID,
  POCKET_SECRET_KEY,
  ALCHEMY_API_KEY,
} = process.env;

const ethProvider = getDefaultProvider("homestead", {
  infura: INFURA_PROJECT_ID,
  pocket: {
    applicationId: POCKET_PROJECT_ID,
    applicationSecretKey: POCKET_SECRET_KEY,
  },
  alchemy: ALCHEMY_API_KEY,
});

/**
 * Get the latest ERC-721 token transfer for a specific collection
 * and for a specific user, using pagination. For reference, see
 * https://docs.etherscan.io/api-endpoints/accounts#get-a-list-of-erc721-token-transfer-events-by-address
 * @param {Object} params - The parameter object
 * @param {String} params.collection - The collection's Ethereum address
 * @param {String} params.address - The user's Ethereum address
 * @param {String} params.seller - The seller's Ethereum address
 * @param {Number} params.page - The page number used in pagination. Default = 1
 * @param {Number} params.offset - The offset within the page. Default = 0
 * @param {Number} params.retries - The number of times the function has
 * already attempted to fetch this information. Default = 0
 * @return {BigNumber|null} - The cost in Ether, if it was
 * possible to calculate it, or null
 */
const getCollectionTxs = async ({
  collection,
  address,
  page = 1,
  offset = 100,
  retries = 0,
}) => {
  const url = `https://api.etherscan.io/api?module=account&action=tokennfttx&contractaddress=${collection.toLowerCase()}&address=${address.toLowerCase()}&sort=asc&apikey=${ETHERSCAN_API_KEY}&page=${page}&offset=${offset}&startblock=0`;
  const response = await fetch(url).then((res) => res.json());
  const { result } = response;
  if (result === "Max rate limit reached") {
    const timeout = Math.random() * 5000 * MAX_GET_COLLECTION_RETRIES - retries;
    if (retries < MAX_GET_COLLECTION_RETRIES) {
      await sleep(timeout);
      return getCollectionTxs({
        collection,
        address,
        page,
        offset,
        retries: retries + 1,
      });
    }

    return [];
  }

  if (!Array.isArray(result)) {
    return [];
  }

  return result;
};

/**
 * Attempt to calculate the amount of Ether paid to purchase a specific NFT
 * @param {Object} params - The parameter object
 * @param {String} params.transactionHash - The hash for the sale tx
 * @param {String} params.seller - The seller's Ethereum address
 * @param {String} params.tokenId - The id of the token being sold
 * @param {String} params.collection - The collection's Ethereum address
 * @param {String} params.standard - The collection's standard. Default: ERC-721
 * @return {BigNumber|null} - The cost in Ether, if it was
 * possible to calculate it, or null
 */
const calculateCost = async ({
  transactionHash,
  seller,
  tokenId,
  collection,
  standard,
}) => {
  if (standard !== "ERC-721") {
    return null;
  }

  const collectionTxs = await getCollectionTxs({ collection, address: seller });
  const tokenTxs = collectionTxs.filter(
    ({ tokenID }) => tokenID === `${tokenId}`
  );
  if (tokenTxs.length === 0) {
    return null;
  }

  const [mostRecentTx, secondMostRecentTx] = tokenTxs;
  const purchaseTx =
    mostRecentTx != null && mostRecentTx.hash === transactionHash
      ? secondMostRecentTx
      : mostRecentTx;
  if (purchaseTx == null) {
    return null;
  }

  const { gasUsed, gasPrice } = purchaseTx;
  const { from, value } = await ethProvider.getTransaction(purchaseTx.hash);
  if (from === seller) {
    const gasEth = BigNumber.from(gasUsed).mul(BigNumber.from(gasPrice));
    return gasEth.add(value);
  }

  return null;
};

/**
 * Retrieve the inner transactions for a specific transaction.
 * See https://docs.etherscan.io/api-endpoints/accounts#get-a-list-of-internal-transactions-by-address
 * @param {String} transactionHash - The transaction hash
 * @return {Array[Object]} - The inner transactions
 */
const getInnerTxs = (transactionHash = "") =>
  fetch(
    `https://api.etherscan.io/api?module=account&action=txlistinternal&txhash=${transactionHash}&apikey=${ETHERSCAN_API_KEY}`
  )
    .then((res) => res.json())
    .then(({ result }) => {
      if (Array.isArray(result)) {
        return result;
      }

      return [];
    })
    .catch(() => []);

/**
 * Attempt to calculate the profit ()
 * @param {Object} params - The parameter object
 * @param {String} params.transactionHash - The hash for the sale tx
 * @param {String} params.seller - The seller's Ethereum address
 * @param {String} params.tokenId - The id of the token being sold
 * @param {String} params.collection - The collection's Ethereum address
 * @param {String} params.standard - The collection's standard. Default: ERC-721
 * @return {String|null} - The profit in Ether, if it was
 * possible to calculate it, or null
 */
export default async (params = {}) => {
  const cost = await calculateCost(params);
  if (cost == null) {
    return null;
  }

  const innerTxs = await getInnerTxs(params.transactionHash);
  const receivedTx = innerTxs.find(
    ({ to }) => to.toLowerCase() === params.seller.toLowerCase()
  );
  if (innerTxs == null) {
    return null;
  }

  const received = BigNumber.from(receivedTx.value);
  return etherUtils.formatEther(etherUtils.parseEther(received.sub(cost)));
};
