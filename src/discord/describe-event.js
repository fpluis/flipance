/// <reference path="../typedefs.js" />

import dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";
import makeAddressReadable from "../make-address-readable.js";

dotenv.config({ path: resolve(".env") });

const { PERSONAL_MODE = true, MARKETPLACES } = process.env;

const gemV2Address = "0x83c8f28c26bf6aaca652df1dbbe0e1b56f8baba2";

const allMarketplaces = JSON.parse(readFileSync("data/marketplaces.json"));

const allMarketplaceIds = allMarketplaces.map(({ id }) => id);
const allowedMarketplaceIds =
  MARKETPLACES == null ? allMarketplaceIds : MARKETPLACES.split(",");

const isLooksRareOnlyMode =
  allowedMarketplaceIds.length === 1 &&
  allowedMarketplaceIds.includes("looksRare");

/**
 * Describe how the price of an NFT event relates to the current floor.
 * @param {EmbedParams} args
 * @return {String}
 */
const describeRelationToFloor = ({
  coin,
  floorDifference,
  collectionFloor,
}) => {
  return collectionFloor == null
    ? ``
    : floorDifference === 0
    ? ` at the collection's floor price`
    : floorDifference < 0
    ? ` ${Number(Math.abs(floorDifference) * 100).toLocaleString(
        "en-US"
      )}% below the current floor price of ${collectionFloor} ${coin}`
    : ` ${Number(floorDifference * 100).toLocaleString(
        "en-US"
      )}% above the current floor price of ${collectionFloor} ${coin}`;
};

/**
 * Generate the price string that will be shown to users on notifications.
 * @param {EmbedParams} args
 * @return {String}
 */
const describePrice = ({ price, coin }) => `${price} ${coin}`;

/**
 * Create the embed descriptions for a new offer event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeAnyOffer = ({
  tokenId,
  buyer,
  priceDescription,
  collectionDescription,
  subjectDescription,
  marketplace,
  watcher,
  initiator,
}) => {
  const subject =
    watcher.address === initiator
      ? subjectDescription
      : `[${makeAddressReadable(
          buyer
        )}](https://etherscan.io/address/${buyer})`;
  let offerDescription;
  if (tokenId == null) {
    offerDescription = `collection offer for all ${collectionDescription} NFTs`;
    if (watcher.address !== initiator && watcher.type === "wallet") {
      offerDescription = `${offerDescription} (${subjectDescription} owns some)`;
    }
  } else {
    offerDescription = `single offer for ${collectionDescription} #${tokenId}`;
    if (watcher.address !== initiator && watcher.type === "wallet") {
      offerDescription = `${offerDescription} (${subjectDescription} currently owns it)`;
    }
  }

  return {
    title: "New offer!",
    description: `${subject} made a ${priceDescription} ${offerDescription} on ${marketplace}`,
  };
};

/**
 * Create the embed descriptions for a new offer event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeLROffer = (args) => {
  const {
    collectionFloor,
    tokenId,
    buyer,
    priceDescription,
    collectionDescription,
    subjectDescription,
    marketplace,
  } = args;
  const offerorDescription = `[${makeAddressReadable(
    buyer
  )}](https://etherscan.io/address/${buyer})`;
  const offerDescription =
    tokenId == null
      ? `any ${collectionDescription} NFT`
      : `${collectionDescription} #${tokenId}`;
  const offerType = tokenId == null ? "collection offer" : "offer";
  return {
    title: "You received a new offer!",
    description: `${subjectDescription} just received a new ${offerType} of ${priceDescription} for ${offerDescription} on ${marketplace} from ${offerorDescription}${
      collectionFloor == null
        ? ""
        : `\n\nThis is ${describeRelationToFloor(args)}`
    }`,
  };
};

/**
 * Create the embed descriptions for a new offer event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeOffer = (args) =>
  isLooksRareOnlyMode ? describeLROffer(args) : describeAnyOffer(args);

/**
 * Create the embed descriptions for a cancel order event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeCancelOrder = ({
  tokenId,
  initiator,
  subjectDescription,
  collectionDescription,
  priceDescription,
  orderType,
  watcher,
  marketplace,
}) => {
  const subject =
    initiator === watcher.address
      ? subjectDescription
      : `[${makeAddressReadable(
          initiator
        )}](https://etherscan.io/address/${initiator})`;
  if (orderType == null) {
    return {
      title: "Order canceled",
      description: `${subject} canceled an order on ${marketplace}`,
    };
  }

  let orderDescription;
  let title;
  if (orderType === "offer") {
    title = PERSONAL_MODE ? "You canceled an offer" : "Offer canceled";
    orderDescription = tokenId
      ? `offer for ${collectionDescription} #${tokenId}`
      : `collection offer for all ${collectionDescription} NFTs`;
  } else if (orderType === "listing") {
    title = PERSONAL_MODE ? "You canceled a listing" : "Listing canceled";
    orderDescription = tokenId
      ? `listing of ${collectionDescription} #${tokenId}`
      : `listing of some ${collectionDescription} NFTs`;
  }

  return {
    title,
    description: `${subject} just canceled a ${priceDescription} ${orderDescription} on ${marketplace}`,
  };
};

/**
 * Create the embed description for an acceptOffer event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeAcceptOffer = (args) => {
  const {
    subjectDescription,
    marketplace,
    priceDescription,
    collectionDescription,
    tokenId,
    watcher,
    buyer,
    seller,
  } = args;
  let description;
  const sellerDescription = `[${makeAddressReadable(
    seller
  )}](https://etherscan.io/address/${seller})`;
  const buyerDescription = `[${makeAddressReadable(
    seller
  )}](https://etherscan.io/address/${buyer})`;
  if (watcher.address === buyer) {
    description = `${subjectDescription}'s ${priceDescription} offer for ${collectionDescription} #${tokenId} was just accepted on ${marketplace}.`;
  } else if (watcher.address === seller) {
    description = `${subjectDescription} just accepted ${buyerDescription}'s ${priceDescription} offer for ${collectionDescription} #${tokenId} on ${marketplace}.`;
  } else {
    description = `${sellerDescription} just accepted ${buyerDescription}'s ${priceDescription} offer for ${collectionDescription} #${tokenId} on ${marketplace}.`;
  }

  return {
    title: PERSONAL_MODE ? "Your offer was accepted!" : "Offer accepted!",
    description,
  };
};

const describeIntermediary = (intermediary) =>
  intermediary === gemV2Address ? "Gem.xyz" : "";

/**
 * Create the embed description for an acceptAsk event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeAcceptAsk = (args) => {
  const {
    subjectDescription,
    marketplace,
    priceDescription,
    collectionDescription,
    tokenId,
    watcher,
    buyer,
    seller,
    intermediary,
  } = args;
  let description;
  const intermediaryString = intermediary
    ? ` through ${describeIntermediary(intermediary)}`
    : "";
  const sellerDescription = `[${makeAddressReadable(
    seller
  )}](https://etherscan.io/address/${seller})`;
  const buyerDescription = `[${makeAddressReadable(
    buyer
  )}](https://etherscan.io/address/${buyer})`;
  if (watcher.address === buyer) {
    description = `${subjectDescription} bought ${sellerDescription}'s ${collectionDescription} #${tokenId} for ${priceDescription} on ${marketplace}${intermediaryString}.`;
  } else if (watcher.address === seller) {
    description = `${subjectDescription} just sold ${collectionDescription} #${tokenId} for ${priceDescription} to ${buyerDescription} on ${marketplace}${intermediaryString}.`;
  } else {
    description = `${sellerDescription} just sold ${collectionDescription} #${tokenId} for ${priceDescription} to ${buyerDescription} on ${marketplace}${intermediaryString}.`;
  }

  return {
    title: PERSONAL_MODE ? "Your item sold!" : "New Sale!",
    description: PERSONAL_MODE ? `Congrats!\n\n${description}` : description,
  };
};

/**
 * Create the embed description for a createAuction event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeCreateAuction = (args) => {
  const {
    watcher,
    subjectDescription,
    initiator,
    marketplace,
    priceDescription,
  } = args;
  const subject =
    watcher.address === initiator
      ? subjectDescription
      : `[${makeAddressReadable(
          initiator
        )}](https://etherscan.io/address/${initiator})`;
  return {
    title: "New Auction Created",
    description: `${subject} created an auction with reserve price ${priceDescription} on ${marketplace}.`,
  };
};

/**
 * Create the embed description for a settleAuction event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeSettleAuction = (args) => {
  const {
    subjectDescription,
    marketplace,
    priceDescription,
    collectionDescription,
    tokenId,
    watcher,
    buyer,
    seller,
  } = args;
  let description;
  const sellerDescription = `[${makeAddressReadable(
    seller
  )}](https://etherscan.io/address/${seller})`;
  const buyerDescription = `[${makeAddressReadable(
    buyer
  )}](https://etherscan.io/address/${buyer})`;
  if (watcher.address === buyer) {
    description = `${subjectDescription} won an auction for ${sellerDescription}'s ${collectionDescription} #${tokenId} for ${priceDescription} on ${marketplace}.`;
  } else {
    description = `${subjectDescription} sold their ${collectionDescription} #${tokenId} in auction to ${buyerDescription} for ${priceDescription} on ${marketplace}.`;
  }

  return {
    title: "Auction sold",
    description,
  };
};

/**
 * Create the embed description for an auctionBid event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeAuctionBid = ({
  tokenId,
  buyer,
  priceDescription,
  collectionDescription,
  subjectDescription,
  marketplace,
  watcher,
  initiator,
}) => {
  const subject =
    watcher.address === initiator
      ? subjectDescription
      : `[${makeAddressReadable(
          buyer
        )}](https://etherscan.io/address/${buyer})`;

  let bidDescription = `bid for ${collectionDescription} #${tokenId}`;
  if (watcher.address !== initiator && watcher.type === "wallet") {
    bidDescription = `${bidDescription} (${subjectDescription} currently owns it)`;
  }

  return {
    title: "New auction bid",
    description: `${subject} placed a ${priceDescription} ${bidDescription} on ${marketplace}`,
  };
};

/**
 * Create the embed description for a listing event.
 * @typedef {Object} EmbedDescriptions
 * @property {String} coin
 * @property {String} priceDescription
 * @property {String} subjectDescription
 * @property {String} collectionDescription
 * @typedef {EmbedParams & EmbedDescriptions} EmbedParamsWithDescriptions
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeListing = (args) => {
  const {
    marketplace,
    watcher,
    seller,
    collectionDescription,
    tokenId,
    priceDescription,
    subjectDescription,
  } = args;
  const subject =
    watcher.address === seller
      ? subjectDescription
      : `[${makeAddressReadable(
          seller
        )}](https://etherscan.io/address/${seller})`;
  return {
    title: PERSONAL_MODE ? "You created a new listing!" : "New Listing",
    description: `${subject} just listed ${collectionDescription} #${tokenId} for sale at ${priceDescription} on ${marketplace}`,
  };
};

/**
 * Generate the alert's name that will be shown to users on the embed.
 * @param {EmbedParams} args
 * @return {String}
 */
const describeSubject = (args) => {
  const {
    watcher: { nickname, address },
  } = args;
  if (nickname == null) {
    return `[${makeAddressReadable(
      address
    )}](https://etherscan.io/address/${address})`;
  }

  return `[${nickname}](https://etherscan.io/address/${address})`;
};

/**
 * Generate the collection's name that will be shown to users on the embed.
 * @param {Object} args
 * @param {Object|null} args.collectionMetadata
 * @param {String} args.collectionMetadata.name
 * @param {String} args.collectionUrl
 * @param {String} args.collection
 * @return {String}
 */
const describeCollection = ({
  collectionMetadata,
  collectionUrl,
  collection,
}) =>
  collectionMetadata.name && collectionMetadata.name.length > 0
    ? `[${collectionMetadata.name}](${collectionUrl})`
    : `[${makeAddressReadable(collection)}](${collectionUrl})`;

/**
 * Create the embed description for an NFT event.
 * @param {EmbedParams} args
 * @return {EmbedDescription}
 */
export default (args) => {
  const { eventType } = args;
  args.coin = ["offer", "acceptOffer", "settleAuction", "cancelOrder"].includes(
    eventType
  )
    ? "WETH"
    : "ETH";
  args.priceDescription = describePrice(args);
  args.subjectDescription = describeSubject(args);
  args.collectionDescription = describeCollection(args);
  switch (eventType) {
    case "offer":
      return describeOffer(args);
    case "cancelOrder":
      return describeCancelOrder(args);
    case "acceptOffer":
      return describeAcceptOffer(args);
    case "acceptAsk":
      return describeAcceptAsk(args);
    case "createAuction":
      return describeCreateAuction(args);
    case "settleAuction":
      return describeSettleAuction(args);
    case "placeBid":
      return describeAuctionBid(args);
    case "listing":
      return describeListing(args);
    default:
      return {};
  }
};
