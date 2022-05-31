import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";
import EventEmitter from "events";
import { ethers, utils as etherUtils, getDefaultProvider } from "ethers";
import logError from "../log-error.js";

dotenv.config({ path: path.resolve(".env") });

const ethContracts = JSON.parse(readFileSync("data/eth-contracts.json"));
const erc721Abi = JSON.parse(readFileSync("data/erc721Abi.json"));
const erc1155Abi = JSON.parse(readFileSync("data/erc1155Abi.json"));
const townStarAbi = JSON.parse(readFileSync("data/townStarAbi.json"));

const openSeaSSAddress = "0x495f947276749Ce646f68AC8c248420045cb7b5e";
const townStarAddress = "0xc36cF0cFcb5d905B8B513860dB0CFE63F6Cf9F5c";

const {
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

const MAX_BLOCK_CACHE_SIZE = 10000;
let blockCache = {};

/**
 * Get the timestamp as seconds since the epoch for the given block number.
 * This function is cached to avoid exhausting the rate limit for the ETH
 * provider APIs
 * @param  {Number} blockNumber - The block number
 * @return {Number} seconds - Seconds since the ECMAScript epoch
 */
const getTimestamp = async (blockNumber) => {
  if (blockNumber == null) {
    return new Date().getTime();
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
      return new Date().getTime();
    });
};

/**
 * Fixes hex addresses padded with zeros often present in tx event logs
 * @param  {String} address - The address to fix
 * @return {String} address - The address without the padding
 */
const parseAddressFromLogs = (address) => {
  if (address.startsWith("0x000000000000000000000000")) {
    return `0x${address.slice(26)}`;
  }

  return address;
};

/**
 * Parses ethers.js on-chain events and extends them with NFT-specific metadata
 * and other relevant information.
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
const parseEvent = async (event, eventType) => {
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
      const tokenId = parseInt(Number(tokenIdHex), 10);
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

/**
 * Creates event listeners for OpenSea's on-chain events that call
 * the supplied _emit_ function with an NFTEvent.
 * @param  {Function} emit - The function that will be called when an
 * OpenSea event happens.
 * @return {ethers.Contract} contract - The ethers.js contract to be
 * able to destroy the event listeners.
 */
const openSeaEventListener = (emit) => {
  const { address, abi } = ethContracts.openSea;
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
    let saleType;
    if (
      parsedEvent.from &&
      parsedEvent.from.toLowerCase() === parsedEvent.initiator.toLowerCase()
    ) {
      saleType = "acceptOffer";
      buyer = maker;
      seller = taker;
    } else {
      saleType = "acceptAsk";
      buyer = taker;
      seller = maker;
    }

    emit(saleType, {
      transactionHash,
      marketplace: "openSea",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.OrderCancelled(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "openSea",
      network: "eth",
      ...parsedEvent,
    });
  });
  return contract;
};

/**
 * Creates event listeners for LooksRare's on-chain events that call
 * the supplied _emit_ function with an NFTEvent.
 * @param  {Function} emit - The function that will be called when an
 * OpenSea event happens.
 * @return {ethers.Contract} contract - The ethers.js contract to be
 * able to destroy the event listeners.
 */
const looksRareEventListener = (emit) => {
  const { address, abi } = ethContracts.looksRare;
  const contract = new ethers.Contract(address, abi, ethProvider);
  contract.on(contract.filters.TakerAsk(), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { maker: buyer, taker: seller, price, amount },
    } = event;
    const parsedEvent = await parseEvent(event);
    emit("acceptOffer", {
      marketplace: "looksRare",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      amount,
      transactionHash,
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.TakerBid(null, null), async (...args) => {
    const event = args[args.length - 1];
    const {
      transactionHash,
      args: { maker: seller, taker: buyer, price, amount },
    } = event;
    const parsedEvent = await parseEvent(event);
    emit("acceptAsk", {
      marketplace: "looksRare",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      amount,
      transactionHash,
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.CancelMultipleOrders(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      network: "eth",
      marketplace: "looksRare",
      ...parsedEvent,
    });
  });
  return contract;
};

/**
 * Creates event listeners for Rarible's on-chain events that call
 * the supplied _emit_ function with an NFTEvent.
 * @param  {Function} emit - The function that will be called when an
 * OpenSea event happens.
 * @return {ethers.Contract} contract - The ethers.js contract to be
 * able to destroy the event listeners.
 */
const raribleEventListener = (emit) => {
  const { address, abi } = ethContracts.rarible;
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
      marketplace: "rarible",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      amount,
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.Cancel(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...parsedEvent,
    });
  });
  return contract;
};

/**
 * Creates event listeners for Foundation's on-chain events that call
 * the supplied _emit_ function with an NFTEvent.
 * @param  {Function} emit - The function that will be called when an
 * OpenSea event happens.
 * @return {ethers.Contract} contract - The ethers.js contract to be
 * able to destroy the event listeners.
 */
const foundationEventListener = (emit) => {
  const { address, abi } = ethContracts.foundation;
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
      marketplace: "foundation",
      seller,
      buyer,
      price: etherUtils.formatEther(priceWithFees),
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.ReserveAuctionCanceled(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.ReserveAuctionBidPlaced(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event);
    emit("placeBid", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.ReserveAuctionCreated(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event);
    emit("createAuction", {
      transactionHash,
      marketplace: "rarible",
      network: "eth",
      ...parsedEvent,
    });
  });
  return contract;
};

/**
 * Creates event listeners for X2Y2's on-chain events that call
 * the supplied _emit_ function with an NFTEvent.
 * @param  {Function} emit - The function that will be called when an
 * OpenSea event happens.
 * @return {ethers.Contract} contract - The ethers.js contract to be
 * able to destroy the event listeners.
 */
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
      marketplace: "x2y2",
      seller,
      buyer,
      price: etherUtils.formatEther(price),
      network: "eth",
      ...parsedEvent,
    });
  });
  contract.on(contract.filters.EvCancel(), async (...args) => {
    const event = args[args.length - 1];
    const { transactionHash } = event;
    const parsedEvent = await parseEvent(event, "cancelOrder");
    emit("cancelOrder", {
      transactionHash,
      marketplace: "x2y2",
      network: "eth",
      ...parsedEvent,
    });
  });
  return contract;
};

/**
 * Create an EventEmitter that listens to transactions on the main
 * NFT marketplaces and emits standardized events.
 * @return {EventEmitter}
 */
export default () => {
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
