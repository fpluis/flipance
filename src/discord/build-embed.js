import { MessageAttachment } from "discord.js";
import sharp from "sharp";
import { getCollectionMetadata } from "../blockchain/index.js";
import logError from "../log-error.js";
import getMetadata from "../get-metadata.js";
import resolveURI from "../resolve-uri.js";

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

const encodeNameURI = (name) => encodeURI(name.replace(/(\s+|#)/giu, "_"));

export default async ({
  eventType,
  isBuyer,
  isSeller,
  transactionHash,
  marketplace: marketplaceId,
  seller: sellerAddress,
  buyer: buyerAddress,
  price: priceEth,
  collection,
  metadataUri,
  collectionFloor,
  tokenIds = [],
  tokenId: originalTokenId,
  target,
  endsAt,
}) => {
  const tokenId =
    originalTokenId == null
      ? tokenIds.length > 0
        ? tokenIds[0]
        : null
      : originalTokenId;
  const priceString = `${Number(priceEth).toFixed(3)} ETH`;
  const metadata = await (metadataUri
    ? getMetadata(metadataUri, tokenId, transactionHash).catch((error) => {
        logError(
          `Error fetching metadata from uri ${metadataUri}; tx hash ${transactionHash}. Error: ${error.toString()}`
        );
        return {};
      })
    : Promise.resolve({}));
  const collectionMetadata = await getCollectionMetadata(collection);
  const marketplace = marketplaceIdToMdLink(marketplaceId);
  let description;
  let title = "New sale!";
  let url = `https://etherscan.io/tx/${transactionHash}`;
  const collectionUrl = `https://looksrare.org/collections/${collection}`;
  if (eventType === "offer") {
    const priceDescription =
      collectionFloor == null
        ? `${priceString}`
        : collectionFloor === priceEth
        ? `${priceString} (at the collection's floor price)`
        : collectionFloor < priceEth
        ? `${priceString} (${Number(
            (100 * (priceEth - collectionFloor)) / priceEth
          ).toFixed(2)}% over the floor price)`
        : `${priceString} (${Number(
            (100 * (collectionFloor - priceEth)) / collectionFloor
          ).toFixed(2)}% below the floor price)`;
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

    title = "New offer!";
    url = tokenId == null ? collectionUrl : `${collectionUrl}/${tokenId}`;
  } else if (isBuyer) {
    description =
      eventType === "acceptOffer"
        ? `You accepted an offer on ${marketplace} for ${priceString}`
        : eventType === "acceptAsk"
        ? `You bought an NFT on ${marketplace} for ${priceString}`
        : `You won an auction on ${marketplace} for ${priceString}`;
  } else if (isSeller) {
    description =
      eventType === "acceptOffer"
        ? `Your offer was accepted on ${marketplace} for ${priceString}`
        : eventType === "acceptAsk"
        ? `You sold your NFT on ${marketplace} for ${priceString}`
        : `You sold an item in auction on ${marketplace} for ${priceString}`;
  } else {
    description =
      eventType === "acceptOffer"
        ? `Offer accepted on ${marketplace} for ${priceString}`
        : eventType === "acceptAsk"
        ? `NFT bought directly on ${marketplace} for ${priceString}`
        : `Auction won on ${marketplace} for ${priceString}`;
  }

  const embed = {
    color: 0x0099ff,
    title,
    url,
    description,
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

  embed.fields.push({
    name: "Buyer",
    value: `[${makeAddressReadable(
      buyerAddress
    )}](https://etherscan.io/address/${buyerAddress})`,
  });

  if (sellerAddress) {
    embed.fields.push({
      name: "Seller",
      value: `[${makeAddressReadable(
        sellerAddress
      )}](https://etherscan.io/address/${sellerAddress})`,
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

  embed.fields.push({
    name: "Marketplace link",
    value: `[View on LooksRare](${
      tokenId == null ? collectionUrl : `${collectionUrl}/${tokenId}`
    })`,
  });

  const files = [];

  let thumbnail;
  if (eventType === "acceptOffer" || eventType === "settleAuction") {
    thumbnail = new MessageAttachment("./assets/weth.png", "weth.png");
  } else {
    thumbnail = new MessageAttachment("./assets/eth.png", "eth.png");
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
            logError(
              `Error generating preview image with sharp: ${JSON.stringify(
                error
              )}`
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
