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

const roundDecimals = (number, decimals = 6) =>
  Number(
    Math.round((Number(number) + Number.EPSILON) * 10 ** decimals) /
      10 ** decimals
  ).toLocaleString("en-US");

const describePrice = ({
  eventType,
  price,
  floorDifference,
  collectionFloor,
}) => {
  const priceString = `${price} ${
    ["offer", "acceptOffer", "settleAuction", "cancelOrder"].includes(eventType)
      ? "WETH"
      : "ETH"
  }`;
  return collectionFloor == null
    ? `${priceString}`
    : floorDifference === 0
    ? `${priceString} (at the collection's floor price)`
    : floorDifference < 0
    ? `${priceString} (${roundDecimals(
        Math.abs(floorDifference) * 100
      )}% below the current ${collectionFloor} ETH floor price)`
    : `${priceString} (${roundDecimals(
        floorDifference * 100
      )}% above the current ${collectionFloor} ETH floor price)`;
};

/**
 * Create the embed descriptions for a new offer event.
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {"user"|"server"} target - Whether the Discord user receiving
 * the notification is a user or a server.
 * @param {String} collectionUrl - The URL for the collection, retrieved
 * from the collection's metadata.
 * @param {String} collectionMetadata - The collection's metadata.
 * @param {String} collectionMetadata.name - The collection's name.
 * @param {String} priceDescription - The price description in Ether.
 * @typedef {Object} EmbedDescription
 * @property {String} title - The embed's title (link at the top of the embed).
 * @property {String} url - The title's url.
 * @property {String} description - The embed's description of the event.
 * @return EmbedDescription
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
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {"user"|"server"} target - Whether the Discord user receiving
 * the notification is a user or a server.
 * @param {String} collectionUrl - The URL for the collection, retrieved
 * from the collection's metadata.
 * @param {String} collectionMetadata - The collection's metadata.
 * @param {String} collectionMetadata.name - The collection's name.
 * @param {String} priceDescription - The price description in Ether.
 * @typedef {Object} EmbedDescription
 * @property {String} title - The embed's title (link at the top of the embed).
 * @property {String} url - The title's url.
 * @property {String} description - The embed's description of the event.
 * @return EmbedDescription
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
 * @param {String} marketplaceId - The marketplace's id. Complete list is
 * available at data/marketplaces.json
 * @param {String} collection - The collection's address on the blockchain.
 * @param {String} tokenId - The id of the token being traded.
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @return EmbedDescription
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
 * @param {String} marketplaceId - The marketplace's id. Complete list is
 * available at data/marketplaces.json
 * @param {String} collection - The collection's address on the blockchain.
 * @param {String} tokenId - The id of the token being traded.
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @return EmbedDescription
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
 * @param {String} marketplaceId - The marketplace's id. Complete list is
 * available at data/marketplaces.json
 * @param {String} collection - The collection's address on the blockchain.
 * @param {String} tokenId - The id of the token being traded.
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @return EmbedDescription
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
 * @param {String} marketplaceId - The marketplace's id. Complete list is
 * available at data/marketplaces.json
 * @param {String} collection - The collection's address on the blockchain.
 * @param {String} tokenId - The id of the token being traded.
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @return EmbedDescription
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
 * @param {String} marketplaceId - The marketplace's id. Complete list is
 * available at data/marketplaces.json
 * @param {String} collection - The collection's address on the blockchain.
 * @param {String} tokenId - The id of the token being traded.
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @return EmbedDescription
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
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @param {String} marketplaceId - One of the marketplace ids defined in
 * data/marketplaces.json
 * @param {String} collection - The collection's Ethereum address
 * @param {String} tokenId - The token's id
 * @return EmbedDescription
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

const describeSubject = ({ watcher: { nickname, address } }) => {
  if (nickname == null) {
    return `[${makeAddressReadable(
      address
    )}](https://etherscan.io/address/${address})`;
  }

  return `[${nickname}](https://etherscan.io/address/${address})`;
};

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
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {"user"|"server"} target - Whether the Discord user receiving
 * the notification is a user or a server.
 * @param {String} collectionUrl - The URL for the collection, retrieved
 * from the collection's metadata.
 * @param {String} collectionMetadata - The collection's metadata.
 * @param {String} collectionMetadata.name - The collection's name.
 * @param {String} priceDescription - The price description in Ether.
 * @typedef {Object} EmbedDescription
 * @property {String} title - The embed's title (link at the top of the embed).
 * @property {String} url - The title's url.
 * @property {String} description - The embed's description of the event.
 * @return EmbedDescription
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
 * @param {String} eventType - One of the event ids defined in data/events.json
 * @param {String} transactionHash - The transaction's hash in Ethereum.
 * @param {String} marketplace - One of the marketplace ids defined in
 * data/marketplaces.json
 * @param {String} seller - The seller's Ethereum address
 * @param {String} buyer - The buyer's Ethereum address
 * @param {String} collection - The collection's Ethereum address
 * @param {String} metadataUri - The collection's metadata URI retrieved
 * from the collection's contract.
 * @param {Number} endsAt - The timestamp (seconds since Epoch) when the
 * event ends. Relevant for offers, auctions and listings.
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {"user"|"server"} target - Whether the Discord user receiving
 * the notification is a user or a server.
 * @param {String} collectionUrl - The URL for the collection, retrieved
 * from the collection's metadata.
 * @param {String} collectionMetadata - The collection's metadata.
 * @param {String} collectionMetadata.name - The collection's name.
 * @typedef {Object} EmbedDescription
 * @property {String} title - The embed's title (link at the top of the embed).
 * @property {String} url - The title's url.
 * @property {String} description - The embed's description of the event.
 * @property {String} nickname - The alert's nickname.
 * @return EmbedDescription
 */
export default async (args) => {
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
  } = args;
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
      ...args,
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
