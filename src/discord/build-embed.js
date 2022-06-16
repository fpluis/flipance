import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { MessageAttachment } from "discord.js";
import sharp from "sharp";
import { getCollectionMetadata } from "../blockchain/index.js";
import logMessage from "../log-message.js";
import getMetadata from "../get-metadata.js";
import resolveURI from "../resolve-uri.js";

const gemV2Address = "0x83c8f28c26bf6aaca652df1dbbe0e1b56f8baba2";

/* Turns a long hex string like "0x123456789123456" into "0x12...3456" */
const makeAddressReadable = (address) =>
  `${address.slice(0, 4)}...${address.slice(address.length - 4)}`;

/* Turns a marketplace id to an embedded link in Markdown */
const marketplaceIdToMdLink = (marketplace) => {
  switch (marketplace) {
    case "looksRare":
      return "[LooksRare](https://looksrare.org/)";
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
const generateTokenMarketplaceURL = (marketplace, collection, tokenId) => {
  switch (marketplace) {
    case "looksRare":
    case "foundation":
      return `https://looksrare.org/collections/${collection}/${tokenId}`;
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

const describePrice = ({ price, floorDifference, collectionFloor }) => {
  const priceString = `${Number(price).toFixed(3)} ETH`;
  return collectionFloor == null
    ? `${priceString}`
    : floorDifference === 0
    ? `${priceString}, at the collection's floor price.`
    : floorDifference < 0
    ? `${priceString}, ${Number(
        (Math.abs(floorDifference) * 100).toFixed(4)
      )}% below the floor price (${collectionFloor} ETH)`
    : `${priceString}, ${Number(
        (floorDifference * 100).toFixed(4)
      )}% above the floor price (${collectionFloor} ETH)`;
};

/**
 * Create the embed descriptions for a new offer event.
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {String} tokenIds - The token ids that the wallet receiving this
 * notification currently owns.
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
  tokenIds = [],
  target,
  collectionUrl,
  collectionMetadata,
  priceDescription,
}) => {
  let description;
  if (target === "user") {
    const firstSentence =
      collectionMetadata.name && collectionMetadata.name.length > 0
        ? `You received a collection offer of ${priceDescription} on all your ${collectionMetadata.name} NFTs (you have ${tokenIds.length}) at LooksRare!`
        : `You received a collection offer of ${priceDescription} on ${tokenIds.length} of your items at LooksRare!`;
    description = `${firstSentence}\n\nYou will also earn $LOOKS if you accept it.`;
  } else {
    const firstSentence =
      collectionMetadata.name && collectionMetadata.name.length > 0
        ? `Someone made a collection offer of ${priceDescription} on all ${collectionMetadata.name} NFTs at LooksRare!`
        : `Someone made a collection offer of ${priceDescription} on all NFTs at LooksRare!`;
    description = `${firstSentence}\n\nYou will also earn $LOOKS if you accept it.`;
  }

  return {
    title: "New offer!",
    url: tokenId == null ? collectionUrl : `${collectionUrl}/${tokenId}`,
    description,
  };
};

/**
 * Create the embed description for an acceptOffer event.
 * @param {Boolean} isBuyer - Whether the notified user is the buyer.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
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
    isBuyer,
    isSeller,
    marketplaceId,
    collection,
    tokenId,
    marketplace,
    priceDescription,
  } = args;
  const description = isBuyer
    ? `You accepted an offer on ${marketplace} for ${priceDescription}`
    : isSeller
    ? `Your offer was accepted on ${marketplace} for ${priceDescription}`
    : `Offer accepted on ${marketplace} for ${priceDescription}`;
  return {
    title: "New Sale!",
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
    description,
  };
};

const describeIntermediary = (intermediary) =>
  intermediary === gemV2Address ? "Gem.xyz" : "";

/**
 * Create the embed description for an acceptAsk event.
 * @param {Boolean} isBuyer - Whether the notified user is the buyer.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
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
    isBuyer,
    isSeller,
    marketplaceId,
    collection,
    tokenId,
    marketplace,
    priceDescription,
    intermediary,
  } = args;
  const intermediaryString = intermediary
    ? ` through ${describeIntermediary(intermediary)}`
    : "";
  const description = isBuyer
    ? `You bought an NFT on ${marketplace} for ${priceDescription}${intermediaryString}`
    : isSeller
    ? `You sold your NFT on ${marketplace} for ${priceDescription}${intermediaryString}`
    : `NFT bought on ${marketplace} for ${priceDescription}${intermediaryString}`;
  return {
    title: "New Sale!",
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
    description,
  };
};

/**
 * Create the embed description for a createAuction event.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
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
    isSeller,
    marketplaceId,
    collection,
    tokenId,
    marketplace,
    priceDescription,
  } = args;
  const description = isSeller
    ? `You created an auction on ${marketplace} with reserve price ${priceDescription}`
    : `Auction created on ${marketplace} with reserve price ${priceDescription}`;
  return {
    title: "New Sale!",
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
    description,
  };
};

/**
 * Create the embed description for a settleAuction event.
 * @param {Boolean} isBuyer - Whether the notified user is the buyer.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
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
    isBuyer,
    isSeller,
    marketplaceId,
    collection,
    tokenId,
    marketplace,
    priceDescription,
  } = args;
  const description = isBuyer
    ? `You won an auction on ${marketplace} for ${priceDescription}`
    : isSeller
    ? `You sold an item in auction on ${marketplace} for ${priceDescription}`
    : `Auction won on ${marketplace} for ${priceDescription}`;
  return {
    title: "New Sale!",
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
    description,
  };
};

/**
 * Create the embed description for an auctionBid event.
 * @param {Boolean} isBuyer - Whether the notified user is the buyer.
 * @param {String} marketplaceId - The marketplace's id. Complete list is
 * available at data/marketplaces.json
 * @param {String} collection - The collection's address on the blockchain.
 * @param {String} tokenId - The id of the token being traded.
 * @param {String} priceDescription - The price description in Ether.
 * @param {String} marketplace - The marketplace's name.
 * @return EmbedDescription
 */
const describeAuctionBid = (args) => {
  const {
    isBuyer,
    marketplaceId,
    collection,
    tokenId,
    marketplace,
    priceDescription,
  } = args;
  const description = isBuyer
    ? `You placed a ${priceDescription} bid on an auction in ${marketplace}`
    : `New ${priceDescription} bid on an auction in ${marketplace}`;
  return {
    title: "New Auction Bid!",
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
    description,
  };
};

/**
 * Create the embed description for a listing event.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
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
    isSeller,
    marketplace,
    marketplaceId,
    priceDescription,
    collection,
    tokenId,
  } = args;
  const description = isSeller
    ? `You listed an item in ${marketplace} for ${priceDescription}`
    : `New listing on ${marketplace} for ${priceDescription}`;
  return {
    title: "New Listing!",
    description,
    url: generateTokenMarketplaceURL(marketplaceId, collection, tokenId),
  };
};

/**
 * Create the embed descriptions for an NFT event.
 * @param {Boolean} isBuyer - Whether the notified user is the buyer.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {String} tokenIds - The token ids that the wallet receiving this
 * notification currently owns.
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
  switch (eventType) {
    case "offer":
      return describeOffer(args);
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
 * @param {Boolean} isBuyer - Whether the notified user is the buyer.
 * @param {Boolean} isSeller - Whether the notified user is the seller.
 * @param {Number} price - The price in Ether.
 * @param {Number} collectionFloor - The collection's floor in Ether.
 * @param {String} tokenId - The token's id.
 * @param {String} tokenIds - The token ids that the wallet receiving this
 * notification currently owns.
 * @param {"user"|"server"} target - Whether the Discord user receiving
 * the notification is a user or a server.
 * @param {String} collectionUrl - The URL for the collection, retrieved
 * from the collection's metadata.
 * @param {String} collectionMetadata - The collection's metadata.
 * @param {String} collectionMetadata.name - The collection's name.
 * @param {String} priceString - The price description in Ether.
 * @typedef {Object} EmbedDescription
 * @property {String} title - The embed's title (link at the top of the embed).
 * @property {String} url - The title's url.
 * @property {String} description - The embed's description of the event.
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
    tokenIds = [],
    tokenId: originalTokenId,
    endsAt,
  } = args;

  const tokenId =
    originalTokenId == null
      ? tokenIds.length > 0
        ? tokenIds[0]
        : null
      : originalTokenId;
  const metadata = await (metadataUri
    ? getMetadata(metadataUri, tokenId, transactionHash).catch((error) => {
        logMessage(
          `Error fetching metadata from uri ${metadataUri}; tx hash ${transactionHash}.`,
          "warning",
          error
        );
        return {};
      })
    : Promise.resolve({}));

  const collectionMetadata = await getCollectionMetadata(collection);
  const marketplace = marketplaceIdToMdLink(marketplaceId);
  const collectionUrl = `https://looksrare.org/collections/${collection}`;
  const embed = {
    color: 0x0099ff,
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

  if (collectionMetadata.name) {
    embed.fields.push([
      {
        name: "Collection",
        value: `[${collectionMetadata.name}](https://looksrare.org/collections/${collection})`,
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

  if (buyerAddress) {
    embed.fields.push({
      name: "Buyer",
      value: `[${makeAddressReadable(
        buyerAddress
      )}](https://looksrare.org/accounts/${buyerAddress})`,
    });
  }

  if (sellerAddress) {
    embed.fields.push({
      name: "Seller",
      value: `[${makeAddressReadable(
        sellerAddress
      )}](https://looksrare.org/accounts/${sellerAddress})`,
      inline: true,
    });
  }

  if (eventType === "offer" && endsAt != null) {
    embed.fields.push({
      name: "Valid until",
      value: new Date(endsAt).toUTCString(),
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
    metadata.attributes.forEach(({ trait_type, value }) => {
      if (
        trait_type != null &&
        trait_type !== "" &&
        trait_type.length > 0 &&
        value != null &&
        value !== "" &&
        value.length > 0
      ) {
        embed.fields.push({
          name: trait_type,
          value: `${value}`,
          inline: true,
        });
      }
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
  if (eventType === "acceptOffer" || eventType === "settleAuction") {
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
            logMessage(
              `Error generating preview image with sharp: ${JSON.stringify(
                error
              )}`,
              "warning"
            );
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
