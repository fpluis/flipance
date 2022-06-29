/// <reference path="../typedefs.js" />

import dotenv from "dotenv";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { MessageAttachment } from "discord.js";
import sharp from "sharp";
import { getCollectionMetadata } from "../blockchain/index.js";
import logMessage from "../log-message.js";
import getMetadata from "../get-metadata.js";
import resolveURI from "../resolve-uri.js";

dotenv.config({ path: resolve(".env") });

const { ETHEREUM_NETWORK } = process.env;

const gemV2Address = "0x83c8f28c26bf6aaca652df1dbbe0e1b56f8baba2";

const looksRareBaseDomain =
  ETHEREUM_NETWORK === "homestead"
    ? "https://looksrare.org"
    : "https://rinkeby.looksrare.org";

/* Turns a long hex string like "0x123456789123456" into "0x12...3456" */
const makeAddressReadable = (address) =>
  `${address.slice(0, 4)}...${address.slice(address.length - 4)}`;

/* Turns a marketplace id to an embedded link in Markdown */
const marketplaceIdToMdLink = (marketplace) => {
  switch (marketplace) {
    case "looksRare":
      return `[LooksRare](${looksRareBaseDomain}/)`;
    case "rarible":
      return "[Rarible](https://rarible.com/)";
    case "foundation":
      return "[Foundation](https://foundation.app/)";
    case "x2y2":
      return "[X2Y2](https://x2y2.io/)";
    case "openSea":
    default:
      return "[OpenSea](https://opensea.io/)";
  }
};

/* Generate the item's URL on the marketplace where the event comes from */
const generateTokenMarketplaceURL = (marketplaceId, collection, tokenId) => {
  if (tokenId == null) {
    return `${looksRareBaseDomain}/collections/${collection}`;
  }

  switch (marketplaceId) {
    case "looksRare":
    case "foundation":
      return `${looksRareBaseDomain}/collections/${collection}/${tokenId}`;
    case "rarible":
      return `https://rarible.com/token/${collection}:${tokenId}`;
    case "x2y2":
      return `https://x2y2.io/eth/${collection}/${tokenId}`;
    case "openSea":
    default:
      return `https://opensea.io/assets/ethereum/${collection}/${tokenId}`;
  }
};

const encodeNameURI = (name) => encodeURI(name.replace(/(\s+|#)/giu, "_"));

/**
 * Generate the price string that will be shown to users on notifications.
 * @param {EmbedParams} args
 * @return {String}
 */
const describePrice = ({
  eventType,
  price,
  floorDifference,
  collectionFloor,
}) => {
  const coin = [
    "offer",
    "acceptOffer",
    "settleAuction",
    "cancelOrder",
  ].includes(eventType)
    ? "WETH"
    : "ETH";
  const priceString = `${price} ${coin}`;
  return collectionFloor == null
    ? `${priceString}`
    : floorDifference === 0
    ? `${priceString} (at the collection's floor price)`
    : floorDifference < 0
    ? `${priceString} (${Number(Math.abs(floorDifference) * 100).toLocaleString(
        "en-US"
      )}% below the current ${collectionFloor} ${coin} floor price)`
    : `${priceString} (${Number(floorDifference * 100).toLocaleString(
        "en-US"
      )}% above the current ${collectionFloor} ${coin} floor price)`;
};

/**
 * Create the embed descriptions for a new offer event.
 * @param {EmbedParamsWithDescriptions} args
 * @return {EmbedDescription}
 */
const describeOffer = ({
  tokenId,
  buyer,
  priceDescription,
  collectionDescription,
  subjectDescription,
  marketplace,
  watcher,
  initiator,
  marketplaceId,
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
    description: `${subject} made a ${priceDescription} ${offerDescription} at ${marketplace}!${
      marketplaceId === "looksRare"
        ? "\n\nThe seller will also earn $LOOKS by accepting the offer."
        : ""
    }`,
  };
};

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
      description: `${subject} canceled an order at ${marketplace}`,
    };
  }

  let orderDescription;
  let title;
  if (orderType === "offer") {
    title = "Offer canceled";
    orderDescription = tokenId
      ? `offer for ${collectionDescription} #${tokenId}`
      : `collection offer for all ${collectionDescription} NFTs`;
  } else if (orderType === "listing") {
    title = "Listing canceled";
    orderDescription = tokenId
      ? `listing of ${collectionDescription} #${tokenId}`
      : `listing of some ${collectionDescription} NFTs`;
  }

  return {
    title,
    description: `${subject} canceled a ${priceDescription} ${orderDescription} at ${marketplace}`,
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
    description = `${subjectDescription}'s ${priceDescription} offer on ${collectionDescription} #${tokenId} was accepted at ${marketplace}.`;
  } else if (watcher.address === seller) {
    description = `${subjectDescription} accepted ${buyerDescription}'s ${priceDescription} offer on ${collectionDescription} #${tokenId} at ${marketplace}.`;
  } else {
    description = `${sellerDescription} accepted ${buyerDescription}'s ${priceDescription} offer on ${collectionDescription} #${tokenId} at ${marketplace}.`;
  }

  return {
    title: "Offer accepted!",
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
    description = `${subjectDescription} bought ${sellerDescription}'s ${collectionDescription} #${tokenId} for ${priceDescription} at ${marketplace}${intermediaryString}.`;
  } else if (watcher.address === seller) {
    description = `${subjectDescription} sold their ${collectionDescription} #${tokenId} to ${buyerDescription} for ${priceDescription} at ${marketplace}${intermediaryString}.`;
  } else {
    description = `${sellerDescription} sold their ${collectionDescription} #${tokenId} to ${buyerDescription} for ${priceDescription} at ${marketplace}${intermediaryString}.`;
  }

  return {
    title: "New Sale!",
    description,
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
    title: "New Auction Created!",
    description: `${subject} created an auction with reserve price ${priceDescription} at ${marketplace}.`,
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
    description = `${subjectDescription} won an auction for ${sellerDescription}'s ${collectionDescription} #${tokenId} for ${priceDescription} at ${marketplace}.`;
  } else {
    description = `${subjectDescription} sold their ${collectionDescription} #${tokenId} in auction to ${buyerDescription} for ${priceDescription} at ${marketplace}.`;
  }

  return {
    title: "Auction sold!",
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
    title: "New auction bid!",
    description: `${subject} placed a ${priceDescription} ${bidDescription} at ${marketplace}!`,
  };
};

/**
 * Create the embed description for a listing event.
 * @typedef {Object} EmbedDescriptions
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
    title: "New Listing!",
    description: `${subject} listed ${collectionDescription} #${tokenId} for ${priceDescription} at ${marketplace}`,
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
 * Create the embed descriptions for an NFT event.
 * @param {EmbedParams} args
 * @return {EmbedDescription}
 */
const describeEvent = (args) => {
  const { eventType } = args;
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

/**
 * Create the embed descriptions for an NFT event.
 *
 * @typedef {"user"|"server"} EmbedTarget - Whether the Discord user receiving
 * the notification is a user or a server.
 * @typedef {Object} EmbedExtraParams
 * @property {Alert} watcher
 * @property {EmbedTarget} target
 * @typedef {NFTEvent & EmbedExtraParams} EmbedParams
 * @param {EmbedParams} params
 * @return {EmbedDescription}
 */
export default async (params) => {
  const {
    eventType,
    transactionHash,
    marketplace: marketplaceId,
    seller: sellerAddress,
    buyer: buyerAddress,
    collection,
    metadataUri,
    tokenId,
    endsAt,
    watcher,
  } = params;
  const { nickname, address: alertAddress } = watcher || {};
  const metadata = await (metadataUri
    ? getMetadata(metadataUri, tokenId, transactionHash).catch((error) => {
        logMessage({
          message: `Error fetching metadata from uri ${metadataUri}; tx hash ${transactionHash}.`,
          level: "warning",
          error,
        });
        return {};
      })
    : Promise.resolve({}));

  const collectionMetadata = await getCollectionMetadata(collection);
  const marketplace = marketplaceIdToMdLink(marketplaceId);
  const collectionUrl = `${looksRareBaseDomain}/collections/${collection}`;
  const embed = {
    color: 0x0099ff,
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
    ...describeEvent({
      ...params,
      collectionMetadata,
      marketplace,
      marketplaceId,
      collectionUrl,
    }),
    fields: [
      {
        name: "Marketplace",
        value: marketplace,
        inline: true,
      },
    ],
    timestamp: new Date(),
  };

  if (nickname || alertAddress) {
    embed.fields.push([
      {
        name: "Alert",
        value: nickname || makeAddressReadable(alertAddress),
      },
    ]);
  }

  if (collectionMetadata.name) {
    embed.fields.push([
      {
        name: "Collection",
        value: `[${collectionMetadata.name}](${looksRareBaseDomain}/collections/${collection})`,
        inline: true,
      },
    ]);
  } else {
    embed.fields.push([
      {
        name: "Collection",
        value: `[${collection}](${looksRareBaseDomain}/collections/${collection})`,
        inline: true,
      },
    ]);
  }

  if (tokenId) {
    embed.fields.push([
      {
        name: "Token Id",
        value: `${tokenId}`,
        inline: true,
      },
    ]);
  }

  if (eventType === "offer" && endsAt != null) {
    embed.fields.push({
      name: "Valid until",
      value: new Date(endsAt).toUTCString(),
    });
  }

  if (buyerAddress) {
    embed.fields.push({
      name: "Buyer",
      value: `[${makeAddressReadable(
        buyerAddress
      )}](${looksRareBaseDomain}/accounts/${buyerAddress})`,
      inline: true,
    });
  }

  if (sellerAddress) {
    embed.fields.push({
      name: "Seller",
      value: `[${makeAddressReadable(
        sellerAddress
      )}](${looksRareBaseDomain}/accounts/${sellerAddress})`,
      inline: buyerAddress != null,
    });
  }

  if (metadata.name && metadata.name.length > 0) {
    const value =
      metadata.external_link && metadata.external_link.length > 0
        ? `[${metadata.name}](${metadata.external_link})`
        : `${metadata.name}`;
    embed.fields.push({
      name: "Name",
      value,
    });
  }

  if (metadata.attributes && Array.isArray(metadata.attributes)) {
    metadata.attributes
      .filter(
        ({ trait_type, value }) =>
          trait_type != null &&
          trait_type !== "" &&
          trait_type.length > 0 &&
          value != null &&
          value !== "" &&
          value.length > 0
      )
      .forEach(({ trait_type, value }) => {
        embed.fields.push({
          name: trait_type,
          value: `${value}`,
          inline: false,
        });
      });
  }

  if (transactionHash) {
    embed.fields.push({
      name: "Ethereum transaction",
      value: `[View on etherscan](https://etherscan.io/tx/${transactionHash})`,
    });
  }

  const files = [];

  let thumbnail;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const assetFolder = join(__dirname, "/../../assets");
  if (
    ["offer", "acceptOffer", "settleAuction", "cancelOrder"].includes(eventType)
  ) {
    thumbnail = new MessageAttachment(`${assetFolder}/weth.png`, "weth.png");
  } else {
    thumbnail = new MessageAttachment(`${assetFolder}/eth.png`, "eth.png");
  }

  embed.thumbnail = {
    url: `attachment://${thumbnail.name}`,
  };
  files.push(thumbnail);

  if (metadata.image && metadata.image.length > 0) {
    const imageURL = resolveURI(metadata.image);
    if (imageURL.startsWith("data:image/")) {
      const [mimeType, base64String] = imageURL.split(";");
      const data = base64String.replace(/^base64,/, "");
      const extension = mimeType.startsWith("data:image/svg") ? "svg" : "jpeg";
      const name =
        metadata.name && metadata.name.length > 0 ? metadata.name : "image";
      let filename = `${encodeNameURI(name)}.${extension}`;
      let attachment;
      if (extension === "svg") {
        const pngBuffer = await sharp(Buffer.from(data, "base64"))
          .png()
          .toBuffer()
          .catch((error) => {
            logMessage({
              message: `Error generating preview image with sharp: ${JSON.stringify(
                error
              )}`,
              level: "warning",
            });
            return { embeds: [], files };
          });
        filename = filename.replace(/svg$/, "png");
        attachment = new MessageAttachment(pngBuffer, filename);
      } else {
        attachment = new MessageAttachment(
          Buffer.from(data, "base64"),
          filename
        );
      }

      files.push(attachment);
      // eslint-disable-next-line require-atomic-updates
      embed.image = {
        url: `attachment://${attachment.name}`,
      };
    } else {
      embed.image = {
        url: imageURL,
      };
    }
  }

  return { embeds: [embed], files };
};
