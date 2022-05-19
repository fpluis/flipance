import { MessageAttachment } from "discord.js";
import fetch from "node-fetch";
import sharp from "sharp";
import { getCollectionMetadata } from "../blockchain/index.js";
import logError from "../log-error.js";

const resolveIPFSUri = (ipfsURI) =>
  `https://ipfs.io/ipfs/${ipfsURI.replace(/^ipfs:\/\//, "")}`;

const resolveArweaveURI = (arweaveURI) =>
  `https://ipfs.io/ipfs/${arweaveURI.replace(
    /^ar:\/\//,
    "https://arweave.net/"
  )}`;

const getImage = (imageURI) =>
  imageURI.startsWith("ipfs://")
    ? resolveIPFSUri(imageURI)
    : imageURI.startsWith("ar://")
    ? resolveArweaveURI(imageURI)
    : imageURI;

const getMetadata = async (metadataURI, tokenId, transactionHash) => {
  if (metadataURI.startsWith(`data:application/json;base64,`)) {
    try {
      const base64String = metadataURI.replace(
        `data:application/json;base64,`,
        ""
      );
      const parsed = JSON.parse(Buffer.from(base64String, "base64"));
      if (parsed.image) {
        return parsed;
      }
    } catch (error) {
      logError(`Error parsing binary as JSON: ${JSON.stringify(error)}`);
      return {};
    }
  }

  let url = metadataURI.startsWith("ipfs://")
    ? resolveIPFSUri(metadataURI)
    : metadataURI.startsWith("ar://")
    ? resolveArweaveURI(metadataURI)
    : metadataURI;
  if (/\{id\}/.test(url)) {
    url = url.replace(`{id}`, tokenId);
  }

  return fetch(url)
    .then(async (response) => {
      const contentTypeRaw = response.headers.get("content-type");
      const contentType = contentTypeRaw ? contentTypeRaw.toLowerCase() : "";
      if (contentType.startsWith("application/json")) {
        return response.json();
      }

      if (contentType.startsWith("text/plain")) {
        let metadata = {};
        try {
          metadata = await response.json();
        } catch (error) {
          const text = await response.text();
          logError(`Plain-text isn't JSON; plain-text: ${text}`);
        }

        return metadata;
      }

      if (contentType.startsWith("text/html")) {
        const { status } = response;
        if (status !== 200) {
          return {};
        }

        return response.text().then(() => {
          return {};
        });
      }

      return {};
    })
    .catch((error) => {
      logError(
        `Error fetching url "${url}" from metadata uri ${metadataURI}; tx hash ${transactionHash}; ${JSON.stringify(
          error
        )}`
      );
      return {};
    });
};

const makeAddressReadable = (address) =>
  `${address.slice(0, 4)}...${address.slice(address.length - 4)}`;

const marketplaceIdToLink = (marketplace) => {
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
  saleType,
  isBuyer,
  isSeller,
  transactionHash,
  marketplace: marketplaceId,
  seller: sellerAddress,
  buyer: buyerAddress,
  price: priceEth,
  collection,
  tokenId,
  metadataUri,
  profit,
  collectionFloor,
  tokenIds,
  target,
}) => {
  const priceString = `${priceEth} ETH`;
  const metadata = await (metadataUri
    ? getMetadata(metadataUri, tokenId, transactionHash)
    : Promise.resolve({}));
  const collectionMetadata = await getCollectionMetadata(collection);
  const marketplace = marketplaceIdToLink(marketplaceId);

  let description;
  let title = "New sale!";
  let url = `https://etherscan.io/tx/${transactionHash}`;
  if (saleType === "offer") {
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
    url = `https://looksrare.org/collections/${collection}/${tokenIds[0]}`;
  } else if (isBuyer) {
    description =
      saleType === "acceptOffer"
        ? `You accepted an offer on ${marketplace} for ${priceString}`
        : saleType === "acceptAsk"
        ? `You bought an NFT on ${marketplace} for ${priceString}`
        : `You won an auction on ${marketplace} for ${priceString}`;
  } else if (isSeller) {
    description =
      saleType === "acceptOffer"
        ? `Your offer was accepted on ${marketplace} for ${priceString}`
        : saleType === "acceptAsk"
        ? `You sold your NFT on ${marketplace} for ${priceString}`
        : `You sold an item in auction on ${marketplace} for ${priceString}`;
  } else {
    description =
      saleType === "acceptOffer"
        ? `Offer accepted on ${marketplace} for ${priceString}`
        : saleType === "acceptAsk"
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

  if (profit) {
    console.log(`Profit non-null for tx ${transactionHash}: ${profit}`);
    if (Number(profit) > 0) {
      embed.fields.push({
        name: "Profit",
        value: `${profit} ETH`,
      });
    } else {
      embed.fields.push({
        name: "Loss",
        value: `${profit} ETH`,
      });
    }
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
    value: `[View on LooksRare](https://looksrare.org/collections/${collection}/${tokenId})`,
  });

  const files = [];

  let thumbnail;
  if (saleType === "acceptOffer" || saleType === "settleAuction") {
    thumbnail = new MessageAttachment("./assets/weth.png", "weth.png");
  } else {
    thumbnail = new MessageAttachment("./assets/eth.png", "eth.png");
  }

  embed.thumbnail = {
    url: `attachment://${thumbnail.name}`,
  };
  files.push(thumbnail);

  if (metadata.image && metadata.image.length > 0) {
    const imageURL = getImage(metadata.image);
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
