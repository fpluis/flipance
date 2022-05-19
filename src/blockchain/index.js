/* eslint-disable no-await-in-loop */
import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";
import EventEmitter from "events";
import {
  ethers,
  utils as etherUtils,
  getDefaultProvider,
  BigNumber,
} from "ethers";
import fetch from "node-fetch";
import logError from "../log-error.js";
import sleep from "../sleep.js";

dotenv.config({ path: path.resolve(".env") });

const LR_COLLECTION_BID_STRATEGY_ADDRESS =
  "0x86f909f70813cdb1bc733f4d97dc6b03b8e7e8f3";
const LR_COLLECTION_STANDARD_SALE_FIXED_PRICE =
  "0x56244bb70cbd3ea9dc8007399f61dfc065190031";
const POLL_COLLECTION_SLICE_DELAY = 60 * 1000;
const MAX_GET_COLLECTION_RETRIES = 3;

const ethContracts = JSON.parse(readFileSync("data/eth-contracts.json"));
const erc721Abi = JSON.parse(readFileSync("data/erc721Abi.json"));
const erc1155Abi = JSON.parse(readFileSync("data/erc1155Abi.json"));
const townStarAbi = JSON.parse(readFileSync("data/townStarAbi.json"));

const openSeaSSAddress = "0x495f947276749Ce646f68AC8c248420045cb7b5e";
const townStarAddress = "0xc36cF0cFcb5d905B8B513860dB0CFE63F6Cf9F5c";

const {
  ETHERSCAN_API_KEY,
  INFURA_PROJECT_ID,
  POCKET_PROJECT_ID,
  ALCHEMY_API_KEY,
} = process.env;

const ethProvider = getDefaultProvider("homestead", {
  infura: INFURA_PROJECT_ID,
  pocket: POCKET_PROJECT_ID,
  alchemy: ALCHEMY_API_KEY,
});

const MAX_BLOCK_CACHE_SIZE = 10000;
let blockCache = {};

const getTimestamp = async (blockNumber) => {
  if (blockNumber == null) {
    return new Date().getSeconds();
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
      return new Date().getSeconds();
    });
};

const parseAddressFromLogs = (address) => {
  if (address.startsWith("0x000000000000000000000000")) {
    return `0x${address.slice(26)}`;
  }

  return address;
};

export const getAddressNFTs = async (moralisClient, address) => {
  const { result: newTokens } = await moralisClient.Web3API.account
    .getNFTs({
      address,
    })
    .catch(() => {
      return { result: [] };
    });
  return newTokens.map(
    ({ token_address, token_id }) => `${token_address}/${token_id}`
  );
};

export const getCollectionMetadata = (collection) => {
  const tokenContract = new ethers.Contract(collection, erc721Abi, ethProvider);
  return Promise.all([
    tokenContract.name().catch((error) => {
      console.log(`Error getting name of collection ${collection}`, error);
      return null;
    }),
  ]).then(([name]) => ({ name }));
};

const getReceiptInfo = async (event, eventType) => {
  const transactionReceipt = await event
    .getTransactionReceipt()
    .catch((error) => {
      logError(
        `Error getting tx receipt of event ${JSON.stringify(
          event
        )}: ${error.toString()}`
      );
      return {};
    });
  if (transactionReceipt == null) {
    logError(`Null tx receipt at ${event.transactionHash}`);
    return {};
  }

  const { from, logs = [], gasUsed, blockNumber } = transactionReceipt;
  const timestamp = await getTimestamp(blockNumber).catch(() => {
    return new Date().getTime();
  });
  const props = { timestamp, initiator: from };
  if (eventType === "cancelOrder") {
    return props;
  }

  try {
    props.gas = gasUsed ? gasUsed.toNumber() : 0;
    const openSeaSSTransfer = logs.find(
      ({ address }) => address === openSeaSSAddress
    );
    if (openSeaSSTransfer) {
      const { data, topics } = openSeaSSTransfer;
      const [, , from, to] = topics;
      // 0x + 64 bit int = 66-length string
      const tokenIdHex = data.slice(0, 66);
      if (tokenIdHex == null) {
        logError(
          `Null token id hex in tx receipt ${JSON.stringify(
            transactionReceipt
          )}`
        );
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
        tokenIdHex,
        tokenId,
        metadataUri,
        standard: "ERC-1155",
        ...props,
        from: parseAddressFromLogs(from),
        to: parseAddressFromLogs(to),
      };
    }

    const erc721TransferLog = logs.find(
      ({ topics }) =>
        topics[0] === etherUtils.id("Transfer(address,address,uint256)") &&
        topics.length === 4
    );
    if (erc721TransferLog) {
      const { address: collection, topics } = erc721TransferLog;
      const [, from, to, tokenIdHex] = topics;
      const tokenId = parseInt(Number(tokenIdHex), 16);
      const tokenContract = new ethers.Contract(
        collection,
        erc721Abi,
        ethProvider
      );
      if (tokenIdHex == null) {
        logError(
          `Null token id in tx receipt ${JSON.stringify(transactionReceipt)}`
        );
      }

      const metadataUri = await tokenContract.tokenURI(tokenIdHex).catch(() => {
        return null;
      });
      return {
        collection,
        tokenId,
        metadataUri,
        standard: "ERC-721",
        ...props,
        from: parseAddressFromLogs(from),
        to: parseAddressFromLogs(to),
      };
    }

    const erc1155TransferLog = logs.find(
      ({ topics }) =>
        topics[0] ===
        etherUtils.id("TransferSingle(address,address,address,uint256,uint256)")
    );
    if (erc1155TransferLog) {
      const { address: collection, data, topics } = erc1155TransferLog;
      const tokenIdHex = data.slice(0, 66);
      const [, , from, to] = topics;
      if (tokenIdHex == null) {
        logError(
          `Null token id in tx receipt ${JSON.stringify(transactionReceipt)}`
        );
      }

      // eslint-disable-next-line no-undef
      const tokenId = BigInt(tokenIdHex).toString(10);
      if (collection === townStarAddress) {
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
          collection,
          tokenId,
          metadataUri,
          standard: "ERC-1155",
          ...props,
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
        collection,
        tokenId,
        metadataUri,
        standard: "ERC-1155",
        ...props,
        from: parseAddressFromLogs(from),
        to: parseAddressFromLogs(to),
      };
    }
  } catch (error) {
    logError(`Error getting the token info: ${error.toString()}`);
  }

  logError(`Unknown token format: ${JSON.stringify(transactionReceipt)}`);
  return props;
};

const openSeaEventListener = (emit) => {
  const { address, abi } = ethContracts.openSea;
  const contract = new ethers.Contract(address, abi, ethProvider);
  contract.on(contract.filters.OrdersMatched(), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { maker, taker, price },
    } = event;
    const receiptInfo = await getReceiptInfo(event);
    let seller;
    let buyer;
    let saleType;
    if (
      receiptInfo.from &&
      receiptInfo.from.toLowerCase() === receiptInfo.initiator.toLowerCase()
    ) {
      saleType = "acceptOffer";
      buyer = maker;
      seller = taker;
    } else {
      saleType = "acceptAsk";
      buyer = maker;
      seller = taker;
    }

    emit(saleType, {
      transactionHash,
      marketplace: "openSea",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.OrderCancelled(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "openSea",
      network: "eth",
      ...receiptInfo,
    });
  });
  return contract;
};

const callLRWithRetries = (endpoint, retries = 3) =>
  fetch(endpoint)
    .then((res) => res.json())
    .then(async (response) => {
      const { data, message, success } = response;
      if (success === true) {
        return data;
      }

      console.log(`Error calling LR: ${message}`);
      if (message === "Too Many Requests") {
        await sleep(Math.random() * 30 * 1000);
        return callLRWithRetries(endpoint, retries - 1);
      }

      return [];
    })
    .catch(async (error) => {
      console.log(
        `Error calling LR. Current retries: ${retries}. Error code: ${error.code}; retries: ${retries}`
      );
      if (["ETIMEDOUT", "ECONNRESET"].includes(error.code) && retries > 0) {
        await sleep(Math.random() * 30 * 1000);
        return callLRWithRetries(endpoint, retries - 1);
      }

      return [];
    });

export const getCollectionOffers = (collection) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=false&collection=${collection}&strategy=${LR_COLLECTION_BID_STRATEGY_ADDRESS}&first=1&status[]=VALID&sort=PRICE_DESC`
  );

export const getCollectionFloor = (collection) =>
  callLRWithRetries(
    `https://api.looksrare.org/api/v1/orders?isOrderAsk=true&collection=${collection}&strategy=${LR_COLLECTION_STANDARD_SALE_FIXED_PRICE}&first=1&status[]=VALID&sort=PRICE_ASC`,
    1
  ).then((listings) => {
    if (listings.length === 0) {
      return null;
    }

    const [{ price }] = listings;
    console.log(
      `Collection floor for ${collection}: ${price} = ${etherUtils.formatEther(
        price
      )}`
    );

    return Number(etherUtils.formatEther(price));
  });

export const pollCollectionOffers = async (
  collectionMap,
  emit,
  currentBids = []
) => {
  const collections = Object.entries(collectionMap);
  const bids = await Promise.all(
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
          const bids = await getCollectionOffers(collection).catch((error) => {
            console.log(
              `Error getting collection bids for ${collection}`,
              error
            );
          });
          if (bids.length === 0) {
            return;
          }

          const [topBid] = bids;
          const { hash, price, endTime: endsAt, signer } = topBid;
          const currentHighestInWei = etherUtils.parseEther(
            `${currentHighest}`
          );
          console.log(
            `Collection ${collection}. Top bid: ${price}; current highest: ${currentHighestInWei}; ends at ${new Date(
              endsAt * 1000
            )}`
          );
          if (
            BigNumber.from(price).gt(BigNumber.from(currentHighestInWei)) ||
            currentEndsAt < new Date().getTime()
          ) {
            emit("offer", {
              ...topBid,
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
  const newBids = currentBids.concat(bids);
  const otherCollections = collections.slice(60);
  if (otherCollections.length > 0) {
    await sleep(POLL_COLLECTION_SLICE_DELAY);
    return pollCollectionOffers(collections.slice(60), emit, newBids);
  }

  return newBids;
};

const looksRareEventListener = (emit) => {
  const { address, abi } = ethContracts.looksRare;
  const contract = new ethers.Contract(address, abi, ethProvider);
  contract.on(contract.filters.TakerAsk(), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { maker: buyer, taker: seller, price, amount },
    } = event;
    const receiptInfo = await getReceiptInfo(event);
    emit("acceptOffer", {
      marketplace: "looksRare",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      amount,
      transactionHash,
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.TakerBid(null, null), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { maker: seller, taker: buyer, price, amount },
    } = event;
    const receiptInfo = await getReceiptInfo(event);
    emit("acceptAsk", {
      marketplace: "looksRare",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      amount,
      transactionHash,
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.CancelMultipleOrders(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      network: "eth",
      marketplace: "looksRare",
      ...receiptInfo,
    });
  });
  return contract;
};

const raribleEventListener = (emit) => {
  const { address, abi } = ethContracts.rarible;
  const contract = new ethers.Contract(address, abi, ethProvider);
  contract.on(contract.filters.Match(), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { leftAsset, newLeftFill, newRightFill, leftMaker, rightMaker },
    } = event;
    const receiptInfo = await getReceiptInfo(event);
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
      marketplace: "rarible",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      amount,
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.Cancel(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...receiptInfo,
    });
  });
  return contract;
};

const foundationEventListener = (emit) => {
  const { address, abi } = ethContracts.foundation;
  const contract = new ethers.Contract(address, abi, ethProvider);
  contract.on(contract.filters.ReserveAuctionFinalized(), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { bidder: buyer, seller, f8nFee, creatorFee },
    } = event;
    const receiptInfo = await getReceiptInfo(event);
    const priceWithFees = f8nFee.add(creatorFee);
    emit("settleAuction", {
      transactionHash,
      marketplace: "foundation",
      seller,
      buyer,
      price: etherUtils.formatEther(priceWithFees),
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.ReserveAuctionCanceled(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.ReserveAuctionBidPlaced(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event);
    emit("placeBid", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.ReserveAuctionCreated(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event);
    emit("createAuction", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...receiptInfo,
    });
  });
  return contract;
};

const x2y2EventListener = (emit) => {
  const { address, abi } = ethContracts.x2y2;
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
    const receiptInfo = await getReceiptInfo(event);

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
      marketplace: "x2y2",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      network: "eth",
      ...receiptInfo,
    });
  });
  contract.on(contract.filters.EvCancel(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const receiptInfo = await getReceiptInfo(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "x2y2",
      network: "eth",
      ...receiptInfo,
    });
  });
  return contract;
};

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

  // Likely an airdrop
  return ethers.BigNumber.from(0);
};

export const calculateProfit = async (args) => {
  const cost = await calculateCost(args);
  if (cost == null) {
    return null;
  }

  const url = `https://api.etherscan.io/api?module=account&action=txlistinternal&txhash=${args.transactionHash}&apikey=${ETHERSCAN_API_KEY}`;
  const response = await fetch(url).then((res) => res.json());
  const { result } = response;
  if (Array.isArray(result)) {
    const receivedTx = result.find(
      ({ to }) => to.toLowerCase() === args.seller.toLowerCase()
    );
    if (receivedTx != null) {
      const received = BigNumber.from(receivedTx.value);
      return etherUtils.formatEther(etherUtils.parseEther(received.sub(cost)));
    }
  } else {
    console.log(
      `Failed to get inner txs for ${
        args.transactionHash
      }; Response: ${JSON.stringify({ response })}`
    );
  }

  return null;
};

export const nftEventEmitter = () => {
  const eventEmitter = new EventEmitter();
  [
    openSeaEventListener,
    looksRareEventListener,
    raribleEventListener,
    foundationEventListener,
    x2y2EventListener,
  ].forEach((listener) => {
    listener((operation, args) => {
      eventEmitter.emit(operation, args);
    });
  });
  return eventEmitter;
};
