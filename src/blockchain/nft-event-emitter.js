/* eslint-disable no-await-in-loop */

/// <reference path="../typedefs.js" />

import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";
import EventEmitter from "events";
import {
  getCollectionFloor,
  getHighestOffers,
  getEvents,
} from "../looksrare-api/index.js";
// eslint-disable-next-line no-unused-vars
import { BigNumber, ethers, providers, utils as etherUtils } from "ethers";
import logMessage from "../log-message.js";
import sleep from "../sleep.js";

dotenv.config({ path: path.resolve(".env") });

const {
  LOOKSRARE_RATE_LIMIT = 120,
  MARKETPLACES,
  ETHEREUM_NETWORK = "homestead",
} = process.env;

const allMarketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const ethContracts = JSON.parse(readFileSync("data/eth-contracts.json"));
const erc721Abi = JSON.parse(readFileSync("data/erc721Abi.json"));
const erc1155Abi = JSON.parse(readFileSync("data/erc1155Abi.json"));
const townStarAbi = JSON.parse(readFileSync("data/townStarAbi.json"));

const allMarketplaceIds = allMarketplaces.map(({ id }) => id);

const openSeaSSAddress = "0x495f947276749ce646f68ac8c248420045cb7b5e";
const townStarAddress = "0xc36cf0cfcb5d905b8b513860db0cfe63f6cf9f5c";
const gemV2Address = "0x83c8f28c26bf6aaca652df1dbbe0e1b56f8baba2";

const LR_SLICE_SIZE = 40;
const ONE_MINUTE = 1 * 60 * 1000;
const POLL_LR_ORDERS_PERIOD = 1 * 60 * 1000;
const MAX_BLOCK_CACHE_SIZE = 100;
const WAIT_FOR_COLLECTIONS = 5 * 1000;
const LOOKSRARE_CACHE_DURATION = 10000;

const emptyContract = { removeAllListeners: () => {} };

const ALLOWED_MARKETPLACE_IDS =
  MARKETPLACES == null ? allMarketplaceIds : MARKETPLACES.split(",");

/**
 * Create an EventEmitter that listens to transactions on the main
 * NFT marketplaces and emits standardized events.
 * @param {providers.Provider} ethProvider - An ethers.js provider already configured
 * @param {String[]} collections - The collections for which to poll offers and listings. On-chain events for other collections will still be emitted even if the collection is not part of this argument.
 * @return {EventEmitter}
 */
export default (ethProvider, collections = []) => {
  let blockCache = {};
  let polling = false;
  let collectionsToPoll = collections;
  let contracts;
  const eventEmitter = new EventEmitter();

  /*
   * A wrapper over the native EventEmitter .emit() function to also include the event
   * type as a property and emit a generic "event" for all types.
   */
  const emit = (eventType, args) => {
    eventEmitter.emit("event", { ...args, eventType });
  };

  /**
   * Get the timestamp as seconds since the epoch for the given block number.
   * This function is cached to avoid exhausting the rate limit for the ETH
   * provider APIs
   * @param  {Number} blockNumber - The block number
   * @return {Number} seconds - Seconds since the ECMAScript epoch
   */
  const getTimestamp = async (blockNumber) => {
    if (blockNumber == null) {
      return new Date().getTime() / 1000;
    }

    if (blockCache[blockNumber] != null) {
      return blockCache[blockNumber];
    }

    return ethProvider
      .getBlock(blockNumber)
      .then(({ timestamp }) => {
        if (Object.entries(blockCache).length < MAX_BLOCK_CACHE_SIZE) {
          blockCache[blockNumber] = timestamp;
        } else {
          blockCache = { blockNumber: timestamp };
        }

        return timestamp;
      })
      .catch(() => {
        return new Date().getTime() / 1000;
      });
  };

  /**
   * Fixes hex addresses padded with zeros often present in tx event logs
   * @param  {String} address - The address to fix
   * @return {String} address - The address without the padding
   */
  const parseAddressFromLogs = (address) => {
    if (address.startsWith("0x000000000000000000000000")) {
      return `0x${address.slice(26)}`.toLowerCase();
    }

    return address.toLowerCase();
  };

  const parseOpenSeaSSLog = async (transferLog) => {
    const { data, topics } = transferLog;
    const [, , from, to] = topics;
    // 0x + 64 bit int = 66-length string
    const tokenIdHex = data.slice(0, 66);
    if (tokenIdHex == null) {
      return null;
    }

    // eslint-disable-next-line no-undef
    const tokenId = BigInt(tokenIdHex).toString(10);
    const tokenContract = new ethers.Contract(
      openSeaSSAddress,
      erc1155Abi,
      ethProvider
    );
    let metadataUri = await tokenContract.uri(tokenIdHex).catch(() => {
      return null;
    });
    if (/0x\{id\}/.test(metadataUri)) {
      metadataUri = metadataUri.replace(`0x{id}`, tokenIdHex);
    }

    return {
      collection: openSeaSSAddress,
      tokenId,
      metadataUri,
      standard: "ERC-1155",
      from: parseAddressFromLogs(from),
      to: parseAddressFromLogs(to),
    };
  };

  const parseERC721Log = async (transferLog) => {
    const { address: collection, topics } = transferLog;
    const [, from, to, tokenIdHex] = topics;
    if (tokenIdHex == null) {
      logMessage({
        message: `Null token id from ERC-721 transfer log ${JSON.stringify(
          transferLog
        )}`,
        level: "warning",
      });
    }

    const tokenId = parseInt(Number(tokenIdHex), 10);
    const tokenContract = new ethers.Contract(
      collection,
      erc721Abi,
      ethProvider
    );
    const metadataUri = await tokenContract.tokenURI(tokenIdHex).catch(() => {
      return null;
    });
    return {
      collection: collection.toLowerCase(),
      tokenId,
      metadataUri,
      standard: "ERC-721",
      from: parseAddressFromLogs(from),
      to: parseAddressFromLogs(to),
    };
  };

  const parseERC1155Log = async (transferLog) => {
    const { address: collection, data, topics } = transferLog;
    const tokenIdHex = data.slice(0, 66);
    if (tokenIdHex == null) {
      return null;
    }

    const [, , from, to] = topics;
    // eslint-disable-next-line no-undef
    const tokenId = BigInt(tokenIdHex).toString(10);
    if (collection.toLowerCase() === townStarAddress) {
      const townStarContract = new ethers.Contract(
        townStarAddress,
        townStarAbi,
        ethProvider
      );
      const events = await townStarContract
        .queryFilter(townStarContract.filters.URI(null, tokenIdHex))
        .catch(() => {
          return [{ args: [] }];
        });
      const [
        {
          args: [metadataUri],
        },
      ] = events;
      return {
        collection: collection.toLowerCase(),
        tokenId,
        metadataUri,
        standard: "ERC-1155",
        from: parseAddressFromLogs(from),
        to: parseAddressFromLogs(to),
      };
    }

    const tokenContract = new ethers.Contract(
      collection,
      erc1155Abi,
      ethProvider
    );
    const metadataUri = await tokenContract.uri(tokenIdHex).catch(() => {
      return null;
    });
    return {
      collection: collection.toLowerCase(),
      tokenId,
      metadataUri,
      standard: "ERC-1155",
      from: parseAddressFromLogs(from),
      to: parseAddressFromLogs(to),
    };
  };

  const parseTransferLog = async (logs, indexInLogs) => {
    const transferLog = logs[indexInLogs];
    const { topics = [], address = "" } = transferLog;
    if (address.toLowerCase() === openSeaSSAddress) {
      return parseOpenSeaSSLog(transferLog);
    }

    if (
      topics[0] === etherUtils.id("Transfer(address,address,uint256)") &&
      topics.length === 4
    ) {
      const ercLog = await parseERC721Log(transferLog).catch((error) => {
        logMessage({
          message: `Error parsing ERC-721 log ${JSON.stringify(transferLog)}`,
          level: "error",
          error,
        });
      });
      if (ercLog.to === gemV2Address) {
        const secondTransfer = logs.slice(indexInLogs + 1).find((log) => {
          const { topics, address: collectionAddress } = log;
          const [topicId, from] = topics;
          return (
            collectionAddress === address &&
            topicId === etherUtils.id("Transfer(address,address,uint256)") &&
            parseAddressFromLogs(from) === gemV2Address
          );
        });

        if (secondTransfer == null) {
          return ercLog;
        }

        const {
          topics: [, , actualBuyer],
        } = secondTransfer;
        return {
          ...ercLog,
          to: parseAddressFromLogs(actualBuyer),
          intermediary: gemV2Address.toLowerCase(),
        };
      }

      return ercLog;
    }

    if (
      topics[0] ===
      etherUtils.id("TransferSingle(address,address,address,uint256,uint256)")
    ) {
      return parseERC1155Log(transferLog).catch((error) => {
        logMessage({
          message: `Error parsing ERC-1155 log ${JSON.stringify(transferLog)}`,
          level: "error",
          error,
        });
      });
    }

    return null;
  };

  /**
   * Parses ethers.js on-chain events and extends them with NFT-specific metadata and other relevant information.
   * @param  {String} event - The address to fix
   * @param  {String} event.transactionHash - The transaction's hash
   * @param  {Object} event.args - The event's arguments. Different for each event
   * and each marketplace.
   * @param  {String} eventType - The event type. See the ids on
   * data/nft-events.json for the possible events.
   * @typedef {Object} ParsedEvent - The returned object
   * @property {Number} timestamp - Tx's timestamp as seconds since
   * the ECMAScript epoch
   * @property {String} initiator - The Ethereum address that initiated
   * the transaction. May not be a user.
   * @property {Number} gas - The gas consumed by the transaction
   * @property {String} collection - The Ethereum address of the NFT collection
   * @property {String} tokenId - The id of the token traded in the transaction
   * @property {String} metadataUri - A valid URI that can be queried for the
   * NFT's metadata
   * @property {String} standard - The token's standard. Can be ERC-1155 or
   * ERC-721.
   * @property {String} from - The address that sends the NFT.
   * @property {String} to - The address that receives the NFT.
   * @return {ParsedEvent}
   */
  const parseEvent = async (event, eventType, contractAddress) => {
    const transactionReceipt = await event
      .getTransactionReceipt()
      .catch((error) => {
        logMessage({
          message: `Error getting tx receipt of event ${JSON.stringify(event)}`,
          level: "warning",
          error,
        });
        return {};
      });
    if (transactionReceipt == null) {
      logMessage({
        message: `Null tx receipt at ${event.transactionHash}`,
        level: "warning",
      });
      return {};
    }

    const { from, logs = [], gasUsed, blockNumber } = transactionReceipt;
    const timestamp = await getTimestamp(blockNumber).catch(() => {
      return new Date().getTime() / 1000;
    });
    const props = { startsAt: new Date(timestamp * 1000), initiator: from };
    if (eventType === "cancelOrder") {
      return props;
    }

    try {
      props.gas = gasUsed ? gasUsed.toNumber() : 0;
      let indexInLogs = logs.findIndex(
        ({ logIndex }) => logIndex === event.logIndex
      );
      if (
        contractAddress != null &&
        contractAddress === ethContracts.openSeaSeaport[ETHEREUM_NETWORK]
      ) {
        // Traverse the tx's logs forwards to find the transfer log
        while (indexInLogs < logs.length) {
          const parsedTransferLog = await parseTransferLog(
            logs,
            indexInLogs
            // eslint-disable-next-line no-loop-func
          ).catch((error) => {
            logMessage({
              message: `Error parsing transfer log ${JSON.stringify({
                logs,
                indexInLogs,
              })}`,
              level: "warning",
              error,
            });
            return null;
          });
          if (parsedTransferLog != null) {
            return {
              ...props,
              ...parsedTransferLog,
            };
          }

          indexInLogs += 1;
        }
      } else {
        // Traverse the tx's logs backwards to find the transfer log
        while (indexInLogs >= 0) {
          const parsedTransferLog = await parseTransferLog(
            logs,
            indexInLogs
            // eslint-disable-next-line no-loop-func
          ).catch((error) => {
            logMessage({
              message: `Error parsing transfer log ${JSON.stringify({
                logs,
                indexInLogs,
              })}`,
              level: "warning",
              error,
            });
            return null;
          });
          if (parsedTransferLog != null) {
            return {
              ...props,
              ...parsedTransferLog,
            };
          }

          indexInLogs -= 1;
        }
      }

      return props;
    } catch (error) {
      logMessage({
        message: `Error getting the token info`,
        level: "warning",
        error,
      });
    }

    logMessage({
      message: `Unknown token format: ${JSON.stringify(transactionReceipt)}`,
      level: "warning",
    });
    return props;
  };

  /**
   * Creates event listeners for OpenSea's on-chain events that call
   * the supplied _emit_ function with an NFTEvent.
   * @return {ethers.Contract} contract - The ethers.js contract to be
   * able to destroy the event listeners.
   */
  const openSeaEventListener = () => {
    const marketplace = "openSea";
    const { [ETHEREUM_NETWORK]: address, abi } = ethContracts.openSea;
    if (address == null) {
      logMessage({
        message: `No address set for OpenSea on network ${ETHEREUM_NETWORK}`,
      });
      return emptyContract;
    }

    const contract = new ethers.Contract(address, abi, ethProvider);
    contract.on(contract.filters.OrdersMatched(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { maker, taker, price },
      } = event;
      const parsedEvent = await parseEvent(event);
      let seller;
      let buyer;
      let eventType;
      if (
        parsedEvent.from &&
        parsedEvent.from === parsedEvent.initiator.toLowerCase()
      ) {
        eventType = "acceptOffer";
        buyer = maker;
        seller = taker;
      } else {
        eventType = "acceptAsk";
        buyer = taker;
        seller = maker;
      }

      emit(eventType, {
        transactionHash,
        marketplace,
        seller,
        buyer,
        price: Number(etherUtils.formatEther(price)),
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.OrderCancelled(), async (...args) => {
      const event = args[args.length - 1];
      const { transactionHash } = event;
      const parsedEvent = await parseEvent(event, "cancelOrder");
      emit("cancelOrder", {
        transactionHash,
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    return contract;
  };

  /**
   * Creates event listeners for OpenSea's Seaport on-chain events that call
   * the supplied _emit_ function with an NFTEvent.
   * @return {ethers.Contract} contract - The ethers.js contract to be
   * able to destroy the event listeners.
   */
  const seaportEventListener = () => {
    const marketplace = "openSea";
    const { [ETHEREUM_NETWORK]: contractAddress, abi } =
      ethContracts.openSeaSeaport;
    if (contractAddress == null) {
      logMessage({
        message: `No address set for OpenSea on network ${ETHEREUM_NETWORK}`,
      });
      return emptyContract;
    }

    const contract = new ethers.Contract(contractAddress, abi, ethProvider);
    contract.on(contract.filters.OrderFulfilled(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { offerer, recipient, consideration, offer },
      } = event;
      const parsedEvent = await parseEvent(event, "acceptAsk", contractAddress);
      const tx = await event.getTransaction().catch(() => {
        return {};
      });
      let seller;
      let buyer;
      let eventType;
      let price;
      let sellerProfit;
      if (
        parsedEvent.from &&
        parsedEvent.from === parsedEvent.initiator.toLowerCase()
      ) {
        eventType = "acceptOffer";
        const { amount = 0 } = offer.length === 0 ? {} : offer[0];
        price = Number(etherUtils.formatEther(amount));
        const expenses = consideration
          ? consideration.reduce(
              (sum, consideration) => sum.add(consideration.amount),
              BigNumber.from(0)
            )
          : BigNumber.from(0);
        sellerProfit = Number(etherUtils.formatEther(amount.sub(expenses)));
        buyer = offerer;
        seller = recipient;
      } else {
        eventType = "acceptAsk";
        const { amount = 0 } =
          consideration.length === 0 ? {} : consideration[0];
        price =
          tx.value && tx.value > 0
            ? Number(etherUtils.formatEther(tx.value.toString()))
            : Number(etherUtils.formatEther(amount));
        sellerProfit = Number(etherUtils.formatEther(amount));
        buyer = recipient;
        seller = offerer;
      }

      emit(eventType, {
        transactionHash,
        marketplace,
        seller,
        buyer,
        sellerProfit,
        price,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.OrderCancelled(), async (...args) => {
      const event = args[args.length - 1];
      const { transactionHash } = event;
      const parsedEvent = await parseEvent(event, "cancelOrder");
      emit("cancelOrder", {
        transactionHash,
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    return contract;
  };

  /**
   * Creates event listeners for LooksRare's on-chain events that call
   * the supplied _emit_ function with an NFTEvent.
   * @return {ethers.Contract} contract - The ethers.js contract to be
   * able to destroy the event listeners.
   */
  const looksRareEventListener = () => {
    const marketplace = "looksRare";
    const { [ETHEREUM_NETWORK]: address, abi } = ethContracts.looksRare;
    if (address == null) {
      logMessage({
        message: `No address set for LooksRare on network ${ETHEREUM_NETWORK}`,
      });
      return emptyContract;
    }

    const contract = new ethers.Contract(address, abi, ethProvider);
    contract.on(contract.filters.TakerAsk(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { orderHash, maker: buyer, taker: seller, price, amount },
      } = event;
      const parsedEvent = await parseEvent(event);
      emit("acceptOffer", {
        orderHash,
        marketplace,
        seller,
        buyer,
        price: Number(etherUtils.formatEther(price)),
        amount: amount.toNumber(),
        transactionHash,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.TakerBid(null, null), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { orderHash, maker: seller, taker: buyer, price, amount },
      } = event;
      const parsedEvent = await parseEvent(event);
      emit("acceptAsk", {
        orderHash,
        marketplace,
        seller,
        buyer,
        price: Number(etherUtils.formatEther(price)),
        amount: amount.toNumber(),
        transactionHash,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    return contract;
  };

  /**
   * Creates event listeners for Rarible's on-chain events that call
   * the supplied _emit_ function with an NFTEvent.
   * @return {ethers.Contract} contract - The ethers.js contract to be
   * able to destroy the event listeners.
   */
  const raribleEventListener = () => {
    const marketplace = "rarible";
    const { [ETHEREUM_NETWORK]: address, abi } = ethContracts.rarible;
    if (address == null) {
      logMessage({
        message: `No address set for Rarible on network ${ETHEREUM_NETWORK}`,
      });
      return emptyContract;
    }

    const contract = new ethers.Contract(address, abi, ethProvider);
    contract.on(contract.filters.Match(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { leftAsset, newLeftFill, newRightFill, leftMaker, rightMaker },
      } = event;
      const parsedEvent = await parseEvent(event);
      let type;
      let seller;
      let buyer;
      let price;
      let amount;
      if (["0x8ae85d84", "0xaaaebeba"].includes(leftAsset.assetClass)) {
        type = "acceptOffer";
        seller = rightMaker;
        buyer = leftMaker;
        price = newRightFill;
        amount = newLeftFill.toNumber();
      } else {
        type = "acceptAsk";
        seller = leftMaker;
        buyer = rightMaker;
        price = newLeftFill;
        amount = newRightFill.toNumber();
      }

      emit(type, {
        transactionHash,
        marketplace,
        seller,
        buyer,
        price: Number(etherUtils.formatEther(price)),
        amount,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.Cancel(), async (...args) => {
      const event = args[args.length - 1];
      const { transactionHash } = event;
      const parsedEvent = await parseEvent(event, "cancelOrder");
      emit("cancelOrder", {
        transactionHash,
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    return contract;
  };

  /**
   * Creates event listeners for Foundation's on-chain events that call
   * the supplied _emit_ function with an NFTEvent.
   * @return {ethers.Contract} contract - The ethers.js contract to be
   * able to destroy the event listeners.
   */
  const foundationEventListener = () => {
    const marketplace = "foundation";
    const { [ETHEREUM_NETWORK]: address, abi } = ethContracts.foundation;
    if (address == null) {
      logMessage({
        message: `No address set for Foundation on network ${ETHEREUM_NETWORK}`,
      });
      return emptyContract;
    }

    const contract = new ethers.Contract(address, abi, ethProvider);
    contract.on(contract.filters.ReserveAuctionFinalized(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { bidder: buyer, seller, f8nFee, creatorFee },
      } = event;
      const parsedEvent = await parseEvent(event);
      const priceWithFees = f8nFee.add(creatorFee);
      emit("settleAuction", {
        transactionHash,
        marketplace,
        seller,
        buyer,
        price: etherUtils.formatEther(priceWithFees),
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.ReserveAuctionCanceled(), async (...args) => {
      const event = args[args.length - 1];
      const { transactionHash } = event;
      const parsedEvent = await parseEvent(event, "cancelOrder");
      emit("cancelOrder", {
        transactionHash,
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.ReserveAuctionBidPlaced(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { bidder: buyer, amount: price, endTime },
      } = event;
      const parsedEvent = await parseEvent(event);
      emit("placeBid", {
        transactionHash,
        buyer,
        price: Number(etherUtils.formatEther(price)),
        endsAt: new Date(endTime.toNumber() * 1000),
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.ReserveAuctionCreated(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: { reservePrice: price, seller, nftContract: collection, tokenId },
      } = event;
      const parsedEvent = await parseEvent(event);
      emit("createAuction", {
        transactionHash,
        collection: collection.toLowerCase(),
        price: Number(etherUtils.formatEther(price)),
        seller,
        tokenId,
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    return contract;
  };

  /**
   * Creates event listeners for X2Y2's on-chain events that call
   * the supplied _emit_ function with an NFTEvent.
   * @return {ethers.Contract} contract - The ethers.js contract to be
   * able to destroy the event listeners.
   */
  const x2y2EventListener = () => {
    const marketplace = "x2y2";
    const { [ETHEREUM_NETWORK]: address, abi } = ethContracts.x2y2;
    if (address == null) {
      logMessage({
        message: `No address set for X2Y2 on network ${ETHEREUM_NETWORK}`,
      });
      return emptyContract;
    }

    const contract = new ethers.Contract(address, abi, ethProvider);
    contract.on(contract.filters.EvInventory(), async (...args) => {
      const event = args[args.length - 1];
      const {
        transactionHash,
        args: {
          maker,
          taker,
          item: { price },
          intent,
        },
      } = event;
      const parsedEvent = await parseEvent(event);

      let buyer;
      let seller;
      let type;
      if (intent.toNumber() === 3) {
        type = "acceptOffer";
        buyer = maker;
        seller = taker;
      } else {
        type = "acceptAsk";
        buyer = taker;
        seller = maker;
      }

      emit(type, {
        transactionHash,
        marketplace,
        seller,
        buyer,
        price: Number(etherUtils.formatEther(price)),
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    contract.on(contract.filters.EvCancel(), async (...args) => {
      const event = args[args.length - 1];
      const { transactionHash } = event;
      const parsedEvent = await parseEvent(event, "cancelOrder");
      emit("cancelOrder", {
        transactionHash,
        marketplace,
        blockchain: "eth",
        ...parsedEvent,
      });
    });
    return contract;
  };

  /**
   * Generic poll function for the LR API.
   * @param {String[]} collections - The collection addresses
   * @param {Function} call - The function that fetches the endpoint and
   * returns a result.
   * @param {Function} handleResponse - The function that handles the response
   * returned by the _call_ parameter.
   */
  const pollLRAPI = async (collections, call, handleResponse, queryType) => {
    const collectionSlice = collections.slice(0, LR_SLICE_SIZE);
    const pollStarted = new Date();
    await Promise.all(
      collectionSlice.map(async (collection) => {
        return call({ collection })
          .then((response) => handleResponse(collection, response))
          .catch((error) => {
            logMessage({
              message: `Error polling LR API`,
              level: "error",
              error,
            });
          });
      })
    );
    const otherCollections = collections.slice(LR_SLICE_SIZE);
    const pollEnded = new Date();
    const msElapsed = pollEnded - pollStarted;
    if (otherCollections.length > 0) {
      const delay = ONE_MINUTE / (LOOKSRARE_RATE_LIMIT / LR_SLICE_SIZE);
      logMessage({
        message: `Polling ${LR_SLICE_SIZE} ${queryType} took ${msElapsed}ms. Intended delay: ${delay}ms. Waiting ${
          delay - msElapsed > 0 ? delay - msElapsed : 0
        }ms before the next poll.`,
        level: "debug",
      });
      if (delay - msElapsed > 0) {
        await sleep(delay);
      }

      return pollLRAPI(otherCollections, call, handleResponse, queryType);
    }

    return Promise.resolve();
  };

  /**
   * Retrieves the floor listings for the collections where at least one user owns an NFT.
   * @param {String[]} collections - The collection addresses
   */
  const pollLRFloors = async (collections) => {
    const handleResponse = async (collection, listings) => {
      if (listings.length === 0) {
        return;
      }

      listings
        .sort(({ price: price1 }, { price: price2 }) => price1 - price2)
        .forEach(async (listing) => {
          const {
            price,
            endTime: endsAt,
            startTime: startsAt,
            hash: orderHash,
            signer,
            tokenId,
          } = listing;
          const tokenContract = new ethers.Contract(
            collection,
            erc721Abi,
            ethProvider
          );
          const metadataUri = await tokenContract
            .tokenURI(tokenId)
            .catch(() => {
              return null;
            });
          emit("listing", {
            ...listing,
            orderHash,
            isNewFloor: true,
            price: Number(etherUtils.formatEther(price)),
            seller: signer,
            startsAt: new Date(startsAt * 1000),
            endsAt: new Date(endsAt * 1000),
            marketplace: "looksRare",
            collection: collection.toLowerCase(),
            metadataUri,
            blockchain: "eth",
            standard: "ERC-721",
          });
        });
    };

    return pollLRAPI(collections, getCollectionFloor, handleResponse, "floors");
  };

  /**
   * Get a collection's first N offers on LooksRare, sorted by price descending
   * (the highest offer will be the first in the returned array). See
   * https://looksrare.github.io/api-docs/#/Orders/OrderController.getOrders
   * for reference.
   * @param {String[]} collections - The collection addresses
   */
  const pollLRCollectionOffers = (collections) => {
    const handleResponse = async (collection, offers) => {
      if (offers.length === 0) {
        return;
      }

      offers.forEach((offer) => {
        const {
          price,
          endTime: endsAt,
          startTime: startsAt,
          signer,
          hash: orderHash,
        } = offer;
        emit("offer", {
          ...offer,
          orderHash,
          isHighestOffer: true,
          price: Number(etherUtils.formatEther(price)),
          buyer: signer,
          startsAt: new Date(startsAt * 1000),
          endsAt: new Date(endsAt * 1000),
          marketplace: "looksRare",
          collection: collection.toLowerCase(),
          blockchain: "eth",
          standard: "ERC-721",
        });
      });
    };

    return pollLRAPI(collections, getHighestOffers, handleResponse, "offers");
  };

  const pollLROrders = async () => {
    if (collectionsToPoll.length === 0) {
      await sleep(WAIT_FOR_COLLECTIONS);
      return pollLROrders();
    }

    logMessage({
      message: `Polling LR Orders from ${collectionsToPoll.length} collections`,
    });
    const pollMethods = [pollLRFloors, pollLRCollectionOffers];
    let index = 0;
    while (index < pollMethods.length) {
      const method = pollMethods[index];
      await method(collectionsToPoll);
      index += 1;
    }

    if (polling) {
      await sleep(POLL_LR_ORDERS_PERIOD);
      return pollLROrders();
    }

    return Promise.resolve();
  };

  const mapLREventType = (eventType) => {
    switch (eventType) {
      case "LIST":
        return "listing";
      case "OFFER":
        return "offer";
      case "CANCEL_LIST":
        return "cancelListing";
      case "CANCEL_OFFER":
        return "cancelOffer";
      default:
        return null;
    }
  };

  /**
   * Handle a LooksRare event.
   * @param {LREvent} event - LooksRare event.
   */
  const handleLREvent = (event) => {
    const { from, hash, type, order, createdAt, token, collection } = event;
    const { address: collectionAddress, type: standard = "ERC-721" } =
      collection;
    const { price, endTime, signer, status, hash: orderHash } = order;
    const endsAt = new Date(endTime * 1000);
    const eventType = mapLREventType(type);
    if (
      endsAt < new Date() ||
      (["offer", "listing"].includes(eventType) && status !== "VALID")
    ) {
      return;
    }

    if (eventType != null) {
      const eventProps = {
        ...order,
        orderHash,
        initiator: from,
        price: Number(etherUtils.formatEther(price)),
        startsAt: new Date(createdAt),
        endsAt,
        collection: collectionAddress.toLowerCase(),
        marketplace: "looksRare",
        blockchain: "eth",
        standard: standard === "ERC1155" ? "ERC-1155" : "ERC-721",
      };
      if (signer && eventType === "listing") {
        eventProps.seller = signer;
      }

      if (signer && eventType === "offer") {
        eventProps.buyer = signer;
      }

      if (token != null) {
        const { tokenId, tokenURI } = token;
        eventProps.tokenId = tokenId;
        eventProps.metadataUri = tokenURI;
      }

      if (eventType === "cancelListing") {
        eventProps.orderType = "listing";
        eventProps.transactionHash = hash;
        emit("cancelOrder", eventProps);
        return;
      }

      if (eventType === "cancelOffer") {
        eventProps.orderType = "offer";
        eventProps.transactionHash = hash;
        emit("cancelOrder", eventProps);
        return;
      }

      emit(eventType, eventProps);
    }
  };

  /**
   * Poll the latest events from LooksRare for any collection.
   * @param {String[]} lastEventIds - LooksRare event ids fetched during the last poll, used to filter already-retrieved events.
   */
  const pollLREvents = async (lastEventIds = []) => {
    const pollStarted = new Date();
    const events = await Promise.all([
      getEvents({ type: "CANCEL_LIST" }),
      getEvents({ type: "CANCEL_OFFER" }),
      getEvents({ type: "LIST" }),
      getEvents({ type: "OFFER" }),
    ]).then(([cancelListings, cancelOffers, lists, offers]) =>
      lists.concat(offers, cancelListings, cancelOffers)
    );
    const newUniqueEvents = events
      .filter(({ id }) => !lastEventIds.includes(id))
      .sort(
        ({ createdAt: createdAt1 }, { createdAt: createdAt2 }) =>
          createdAt1 - createdAt2
      );
    newUniqueEvents.forEach((event) => {
      handleLREvent(event);
    });
    if (polling) {
      const msElapsed = new Date() - pollStarted;
      await sleep(LOOKSRARE_CACHE_DURATION - msElapsed);
      const lastEventIds = events.map(({ id }) => id);
      return pollLREvents(lastEventIds);
    }

    return Promise.resolve();
  };

  /**
   * Set for which collections the highest offers and collection floors will be periodically polled from marketplace APIs.
   * @param {String[]} collections - Blockchain addresses for the collections
   */
  eventEmitter.setCollectionsToPoll = (collections) => {
    collectionsToPoll = collections;
  };

  /**
   * Create the on-chain listeners and start polling marketplaces.
   */
  eventEmitter.start = () => {
    polling = true;
    contracts = [
      { listener: openSeaEventListener, id: "openSea" },
      { listener: seaportEventListener, id: "openSea" },
      { listener: looksRareEventListener, id: "looksRare" },
      { listener: raribleEventListener, id: "rarible" },
      { listener: foundationEventListener, id: "foundation" },
      { listener: x2y2EventListener, id: "x2y2" },
    ]
      .filter(({ id }) => ALLOWED_MARKETPLACE_IDS.includes(id))
      .map(({ listener }) => listener());

    if (ALLOWED_MARKETPLACE_IDS.includes("looksRare")) {
      pollLROrders();
      pollLREvents();
    }
  };

  /**
   * Destroy the on-chain listeners and stop polling marketplaces.
   */
  eventEmitter.stop = () => {
    contracts.forEach((contract) => contract.removeAllListeners());
    eventEmitter.removeAllListeners();
    polling = false;
  };

  return eventEmitter;
};
