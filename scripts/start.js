/* eslint-disable no-await-in-loop */
import path from "path";
import dotenv from "dotenv";
import { utils as etherUtils, BigNumber } from "ethers";
import { Client, Intents, MessageAttachment } from "discord.js";
import fetch from "node-fetch";
import sharp from "sharp";
import { alerts, loadAlerts } from "../src/database/alerts.js";
import handleInteraction from "../src/discord/handle-interaction.js";
import {
  nftEventEmitter,
  calculateProfit,
  getCollectionMetadata,
  getUserNfts,
} from "../src/blockchain.js";
import logError from "../src/log-error.js";
import registerCommands from "../src/discord/register-commands.js";
import { users, loadUsers, updateUserTokens } from "../src/database/users.js";
import sleep from "../src/sleep.js";
import moralisClient from "moralis/node.js";
import { loadCollectionBids } from "../src/database/collection-bids.js";

dotenv.config({ path: path.resolve(".env") });

const {
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MORALIS_SERVER_URL,
  MORALIS_APP_ID,
  MORALIS_MASTER_KEY,
} = process.env;

const POLL_USER_TOKENS_INTERVAL = 5 * 60 * 1000;

const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
const [, , testArg] = process.argv;
discordClient.login(
  testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
);

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

const buildEmbed = async ({
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
}) => {
  const price = `${priceEth} ETH`;
  const metadata = await (metadataUri
    ? getMetadata(metadataUri, tokenId, transactionHash)
    : Promise.resolve({}));
  const collectionMetadata = await getCollectionMetadata(collection);
  const marketplace = marketplaceIdToLink(marketplaceId);

  let description;
  let title = "New sale!";
  let url = `https://etherscan.io/tx/${transactionHash}`;
  if (saleType === "bid") {
    const priceDescription =
      collectionFloor == null
        ? `${price}`
        : collectionFloor === price
        ? `${price} (at the collection's floor price)`
        : collectionFloor < price
        ? `${price} (${
            (price - collectionFloor) / price
          }% over the floor price)`
        : `${price} (${
            (collectionFloor - price) / collectionFloor
          }% below the floor price)`;
    const firstSentence =
      collectionMetadata.name && collectionMetadata.name.length > 0
        ? `You received a collection offer of ${priceDescription} on your ${collectionMetadata.name} at LooksRare!`
        : `You received a collection offer of ${priceDescription} on one of your items at LooksRare!`;
    description = `${firstSentence}\n\nYou will also earn $LOOKS if you accept it.`;
    title = "New offer!";
    url = `https://looksrare.org/collections/${collection}/${tokenId}`;
  } else if (isBuyer) {
    description =
      saleType === "acceptOffer"
        ? `You accepted an offer on ${marketplace} for ${price}`
        : saleType === "acceptAsk"
        ? `You bought an NFT on ${marketplace} for ${price}`
        : `You won an auction on ${marketplace} for ${price}`;
  } else if (isSeller) {
    description =
      saleType === "acceptOffer"
        ? `Your offer was accepted on ${marketplace} for ${price}`
        : saleType === "acceptAsk"
        ? `You sold your NFT on ${marketplace} for ${price}`
        : `You sold an item in auction on ${marketplace} for ${price}`;
  } else {
    description =
      saleType === "acceptOffer"
        ? `Offer accepted on ${marketplace} for ${price}`
        : saleType === "acceptAsk"
        ? `NFT bought directly on ${marketplace} for ${price}`
        : `Auction won on ${marketplace} for ${price}`;
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
    const value = etherUtils.parseEther(profit);
    if (value.gt(BigNumber.from(0))) {
      embed.fields.push({
        name: "Profit",
        value: `${value} ETH`,
      });
    } else {
      embed.fields.push({
        name: "Loss",
        value: `${value} ETH`,
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

const isAllowedByUserPreferences = (
  { marketplace, saleType, collectionFloor, price },
  { allowedMarketplaces, allowedEvents, maxOfferFloorDifference }
) => {
  if (
    !allowedMarketplaces.includes(marketplace) ||
    !allowedEvents.includes(saleType)
  ) {
    return false;
  }

  if (saleType === "bid" && collectionFloor != null) {
    if (price >= collectionFloor) {
      return true;
    }

    const floorDifference = (collectionFloor - price) / collectionFloor;
    console.log(
      `Is price lower than the max offer floor difference? ${floorDifference}, ${maxOfferFloorDifference}, ${
        floorDifference < maxOfferFloorDifference
      }`
    );
    return floorDifference < maxOfferFloorDifference;
  }

  return true;
};

const notifySales = async (discordClient) => {
  const handleSale = async (args) => {
    const {
      seller: sellerAddress = "",
      buyer: buyerAddress = "",
      collection: collectionAddress = "",
      userId = "",
    } = args;
    if (userId && isAllowedByUserPreferences(args, users[userId])) {
      try {
        const discordUser = await discordClient.users.fetch(userId);
        const embed = await buildEmbed(args);
        discordUser.send(embed).catch((error) => {
          logError(
            `Error sending bid notification to user ${userId}; Error: ${error.toString()}`
          );
        });
      } catch (error) {
        console.log(
          `Error handling bid with args ${JSON.stringify({
            ...args,
          })}: ${error.toString()}`
        );
      }
    }

    const sellerWatchers = alerts[sellerAddress.toLowerCase()];
    if (sellerWatchers) {
      sellerWatchers
        .filter(({ userId }) => isAllowedByUserPreferences(args, users[userId]))
        .forEach(async ({ userId }) => {
          try {
            const profit = await calculateProfit(args);
            const discordUser = await discordClient.users.fetch(userId);
            const embed = await buildEmbed({
              ...args,
              profit,
              isSeller: true,
            });
            discordUser.send(embed).catch((error) => {
              logError(
                `Error sending message to seller ${userId}; Error: ${error.toString()}`
              );
            });
          } catch (error) {
            logError(
              `Could not notify user ${userId} of sale; Error: ${error.toString()}`
            );
          }
        });
    }

    const buyerWatchers = alerts[buyerAddress.toLowerCase()];
    if (buyerWatchers) {
      buyerWatchers
        .filter(({ userId }) => isAllowedByUserPreferences(args, users[userId]))
        .forEach(async ({ userId }) => {
          try {
            const discordUser = await discordClient.users.fetch(userId);
            const embed = await buildEmbed({
              ...args,
              isBuyer: true,
            });
            discordUser.send(embed).catch((error) => {
              logError(
                `Error sending message to buyer ${userId}; Error: ${error.toString()}`
              );
            });
          } catch (error) {
            logError(
              `Could not notify user ${userId} of purchase; Error: ${error.toString()}`
            );
          }
        });
    }

    const collectionWatchers = alerts[collectionAddress.toLowerCase()];
    if (collectionWatchers) {
      collectionWatchers.forEach(async ({ channelId }) => {
        if (channelId == null) {
          return;
        }

        try {
          const channel = await discordClient.channels.fetch(channelId);
          const embed = await buildEmbed(args);
          channel.send(embed);
        } catch (error) {
          logError(
            `Error sending collection alert to channel ${channelId}: ${error.toString()}`
          );
        }
      });
    }
  };

  const eventEmitter = nftEventEmitter();
  ["acceptAsk", "acceptOffer", "settleAuction", "bid"].forEach((saleType) => {
    eventEmitter.on(saleType, (args) => {
      try {
        handleSale({ ...args, saleType });
      } catch (error) {
        logError(
          `Error handling sale with args ${JSON.stringify({
            ...args,
            saleType,
          })}: ${error.toString()}`
        );
      }
    });
  });
};

const pollUserTokens = async () => {
  let index = 0;
  const entries = Object.entries(users);
  while (index < entries) {
    const [id, { addresses, syncedAt }] = entries[index];
    if (
      syncedAt == null ||
      new Date() - new Date(syncedAt) > POLL_USER_TOKENS_INTERVAL
    ) {
      const tokens = await getUserNfts(moralisClient, addresses);
      await updateUserTokens({ id, tokens });
    }

    index += 1;
  }

  await sleep(POLL_USER_TOKENS_INTERVAL);
  pollUserTokens();
};

discordClient.once("ready", async () => {
  console.log(`Logged in as ${discordClient.user.tag}!`);
  console.time("load-alerts");
  await Promise.all([loadCollectionBids(), loadAlerts(), loadUsers()]);
  console.timeEnd("load-alerts");
  notifySales(discordClient);
  await moralisClient.start({
    serverUrl: MORALIS_SERVER_URL,
    appId: MORALIS_APP_ID,
    masterKey: MORALIS_MASTER_KEY,
  });
  pollUserTokens();
});

discordClient.on("interactionCreate", (interaction) => {
  handleInteraction(discordClient, moralisClient, interaction);
});

discordClient.on("guildCreate", (guild) => {
  console.log(`Guild create event: ${guild.id}`);
  registerCommands(guild.id);
});
