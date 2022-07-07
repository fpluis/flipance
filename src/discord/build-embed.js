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
import makeAddressReadable from "../make-address-readable.js";
import describeEvent from "./describe-event.js";

dotenv.config({ path: resolve(".env") });

const { ETHEREUM_NETWORK, SHOW_NFT_ATTRIBUTES = false } = process.env;

const looksRareBaseDomain =
  ETHEREUM_NETWORK === "homestead"
    ? "https://looksrare.org"
    : "https://rinkeby.looksrare.org";

const toLooksRareEventType = (eventType) => {
  switch (eventType) {
    case "listing":
      return "createListing";
    case "offer":
      return "receiveOffer";
    default:
      return eventType;
  }
};

/* Turns a marketplace id to an embedded link in Markdown */
const marketplaceIdToMdLink = (marketplace, eventType) => {
  switch (marketplace) {
    case "looksRare":
      return `[LooksRare](${looksRareBaseDomain}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
        eventType
      )})`;
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
const generateTokenMarketplaceURL = (
  marketplaceId,
  collection,
  tokenId,
  eventType
) => {
  if (tokenId == null) {
    return `${looksRareBaseDomain}/collections/${collection}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
      eventType
    )}`;
  }

  switch (marketplaceId) {
    case "looksRare":
    case "foundation":
      return `${looksRareBaseDomain}/collections/${collection}/${tokenId}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
        eventType
      )}`;
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
 * Create the embed descriptions for an NFT event.
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
  const marketplace = marketplaceIdToMdLink(marketplaceId, eventType);
  const collectionUrl = `${looksRareBaseDomain}/collections/${collection}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
    eventType
  )}`;
  const embed = {
    color: 0x0099ff,
    url: generateTokenMarketplaceURL(
      marketplaceId,
      collection,
      tokenId,
      eventType
    ),
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
        value: `[${
          collectionMetadata.name
        }](${looksRareBaseDomain}/collections/${collection}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
          eventType
        )})`,
        inline: true,
      },
    ]);
  } else {
    embed.fields.push([
      {
        name: "Collection",
        value: `[${collection}](${looksRareBaseDomain}/collections/${collection}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
          eventType
        )})`,
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
      )}](${looksRareBaseDomain}/accounts/${buyerAddress}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
        eventType
      )})`,
      inline: true,
    });
  }

  if (sellerAddress) {
    embed.fields.push({
      name: "Seller",
      value: `[${makeAddressReadable(
        sellerAddress
      )}](${looksRareBaseDomain}/accounts/${sellerAddress}?utm_source=discord&utm_medium=notification&utm_campaign=${toLooksRareEventType(
        eventType
      )})`,
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

  if (
    metadata.attributes &&
    Array.isArray(metadata.attributes) &&
    SHOW_NFT_ATTRIBUTES === true
  ) {
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
  const imageName = `${embed.title
    .replace(/\s/giu, "_")
    .replace(/!/giu, "")}.png`;
  if (
    ["offer", "acceptOffer", "settleAuction", "cancelOrder"].includes(eventType)
  ) {
    thumbnail = new MessageAttachment(`${assetFolder}/weth.png`, imageName);
  } else {
    thumbnail = new MessageAttachment(`${assetFolder}/eth.png`, imageName);
  }

  thumbnail.setDescription(embed.title);
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
