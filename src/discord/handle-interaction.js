import path from "path";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { utils } from "ethers";
import { MessageActionRow, MessageSelectMenu } from "discord.js";
import { bold } from "@discordjs/builders";
import logError from "../log-error.js";

dotenv.config({ path: path.resolve(".env") });

const { MAX_NICKNAME_LENGTH = 50 } = process.env;

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const isValidAddress = (address) => {
  try {
    utils.getAddress(address);
    return true;
  } catch (error) {
    return false;
  }
};

const isValidNickname = (nickname) => nickname != null && !/\s/.test(nickname);

const handleCollectionAlert = async ({ dbClient, interaction }) => {
  const { guildId: discordId, channelId, memberPermissions } = interaction;
  await interaction.deferReply({
    content: "Creating your alert...",
    ephemeral: true,
  });

  if (!memberPermissions.has("ADMINISTRATOR")) {
    return interaction.editReply({
      content:
        "You need administrator permissions to add a collection watch to this server.",
      ephemeral: true,
    });
  }

  let { object: user } = await dbClient.getUserByDiscordId({ discordId });
  if (user == null) {
    const { object: newUser } = await dbClient.createUser({
      discordId,
      type: "server",
      tokens: [],
    });
    user = newUser;
  }

  const { objects: currentAlerts } = await dbClient.getUserAlerts({
    discordId,
  });
  if (currentAlerts.length >= user.alertLimit) {
    return interaction.editReply({
      content:
        "You can only have one collection alert per server. Please remove the current collection alert on this server to add a new one.",
      ephemeral: true,
    });
  }

  const address = interaction.options.getString("address");
  const nickname = interaction.options.getString("nickname");
  if (!isValidAddress(address)) {
    return interaction.editReply({
      content: `Address "${address}" is invalid. Please introduce a valid address.`,
      ephemeral: true,
    });
  }

  if (nickname != null && !isValidNickname(nickname)) {
    return interaction.editReply({
      content: `Nickname "${nickname}" contains spaces. Please, remove the spaces and try again.`,
      ephemeral: true,
    });
  }

  // The token for collection alert is set to an empty string.
  const tokens = [`${address}/`];
  const { result } = await dbClient.createAlert({
    userId: user.id,
    channelId,
    type: "collection",
    address,
    tokens,
    nickname,
  });
  switch (result) {
    case "success":
      return interaction.editReply({
        content: `Alert successfully created for address ${address}${
          nickname ? `with nickname ${nickname}.` : "."
        }`,
        ephemeral: true,
      });
    case "nickname-too-long":
      return interaction.editReply({
        content: `The nickname is too long. Please give the alert a nickname less than ${MAX_NICKNAME_LENGTH} characters long.`,
        ephemeral: true,
      });
    case "error":
    case "missing-user":
      return interaction.editReply({
        content: `There was an error processing your request. Please try again later.`,
        ephemeral: true,
      });
    case "already-exists":
    default:
      return interaction.editReply({
        content: `You already have a collection alert for address ${address}.`,
        ephemeral: true,
      });
  }
};

const handleListAlerts = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
    guildId,
  } = interaction;
  await interaction.deferReply({
    content: "Fetching your alerts...",
    ephemeral: true,
  });
  const [{ objects: currentAlerts }, { objects: guildAlerts }] =
    await Promise.all([
      dbClient.getUserAlerts({ discordId }),
      dbClient.getUserAlerts({ discordId: guildId }),
    ]);
  if (currentAlerts.length === 0 && guildAlerts.length === 0) {
    return interaction.editReply({
      content:
        "You haven't set up any alerts yet. To create a wallet alert, use the /walletalert command with the wallet address you want to watch. To create a collection alert, use the /collectionalert with the with the collection address you want to watch.",
      ephemeral: true,
    });
  }

  const walletAlertList = currentAlerts.reduce(
    (message, { nickname, address }) => {
      const fixedNickname = nickname == null ? "(no nickname)" : bold(nickname);
      return `${message}\n${fixedNickname}: ${address}`;
    },
    ""
  );
  const collectionAlertList = guildAlerts.reduce(
    (message, { nickname, address }) => {
      const fixedNickname = nickname == null ? "(no nickname)" : bold(nickname);
      return `${message}\n${fixedNickname}: ${address}`;
    },
    ""
  );
  let content;
  if (currentAlerts.length === 0) {
    content = `You have not set up any wallet alerts. These are the server's alerts:${collectionAlertList}.`;
  } else if (guildAlerts.length === 0) {
    content = `These are your wallet alerts:${walletAlertList}.\n\nThere are no server alerts.`;
  } else {
    content = `These are your wallet alerts:${walletAlertList}.\n\nThese are the server's collection alerts:${collectionAlertList}.`;
  }

  return interaction.editReply({
    content,
    ephemeral: true,
  });
};

const handleWalletAlert = async ({
  dbClient,
  discordClient,
  nftClient,
  interaction,
}) => {
  const {
    user: { id: discordId },
  } = interaction;
  await interaction.deferReply({
    content: "Creating your alert...",
    ephemeral: true,
  });

  let { object: user } = await dbClient.getUserByDiscordId({ discordId });
  if (user == null) {
    const { object: newUser } = await dbClient.createUser({
      discordId,
      type: "user",
    });
    user = newUser;
  }

  const { objects: currentAlerts } = await dbClient.getUserAlerts({
    discordId,
  });
  if (currentAlerts.length >= user.alertLimit) {
    return interaction.editReply({
      content:
        "You have reached your alert limit. Please remove one of your existing alerts to add more alerts.",
      ephemeral: true,
    });
  }

  const address = interaction.options.getString("address");
  if (!isValidAddress(address)) {
    return interaction.editReply({
      content: `Address "${address}" is invalid. Please introduce a valid address.`,
      ephemeral: true,
    });
  }

  const nickname = interaction.options.getString("nickname").trim();
  if (nickname != null && !isValidNickname(nickname)) {
    return interaction.editReply({
      content: `Nickname "${nickname}" contains spaces. Please, remove the spaces and try again.`,
      ephemeral: true,
    });
  }

  const tokens = await nftClient.getAddressNFTs(address);
  const { result } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address,
    tokens,
    nickname,
  });
  switch (result) {
    case "success":
      return discordClient.users.cache
        .get(discordId)
        .send(
          `Notifications for "${address}" enabled. Please don't turn off your DMs on every server we share so I can keep messaging you.`
        )
        .then(() => {
          return interaction.editReply({
            content: `Alert successfully created for address ${address}.`,
            ephemeral: true,
          });
        })
        .catch(() => {
          return interaction.editReply({
            content: `\nYou have your DMs turned off. Please enable DMs on at least one server we share so I can notify you of a wallet's activity.`,
            ephemeral: true,
          });
        });
    case "nickname-too-long":
      return interaction.editReply({
        content: `The nickname is too long. Please give the alert a nickname less than ${MAX_NICKNAME_LENGTH} characters long.`,
        ephemeral: true,
      });
    case "error":
    case "missing-user":
      return interaction.editReply({
        content: `There was an error processing your request. Please try again later.`,
        ephemeral: true,
      });
    case "already-exists":
    default:
      return interaction.editReply({
        content: `You already have an alert for address ${address}.`,
        ephemeral: true,
      });
  }
};

const handleDeleteAlert = async ({ dbClient, interaction }) => {
  const {
    guildId,
    user: { id: discordId },
    memberPermissions,
  } = interaction;
  await interaction.deferReply({
    content: "Deleting your alert...",
    ephemeral: true,
  });
  const alert = interaction.options.getString("alert");
  const address = isValidAddress(alert) ? alert : null;
  const nickname = isValidNickname(alert) ? alert : null;

  const { result } = await dbClient
    .deleteAlert({
      discordId,
      address,
      nickname,
    })
    .then(({ result }) => {
      if (
        result === "missing-alert" &&
        memberPermissions.has("ADMINISTRATOR")
      ) {
        return dbClient.deleteAlert({
          discordId: guildId,
          address,
          nickname,
        });
      }

      return { result };
    });

  const identifier =
    address == null ? `with nickname ${nickname}` : `for address ${address}`;
  switch (result) {
    case "success":
      return interaction.editReply({
        content: `Alert ${identifier} successfully removed.`,
        ephemeral: true,
      });
    case "missing-arguments":
      return interaction.editReply({
        content: `Please specify a valid address or nickname to delete.`,
        ephemeral: true,
      });
    case "missing-alert":
    default:
      return interaction.editReply({
        content: `You have no alert set up ${identifier}.`,
        ephemeral: true,
      });
  }
};

const describeSettings = ({
  alertLimit,
  maxOfferFloorDifference,
  allowedMarketplaces,
  allowedEvents,
  address,
  nickname,
}) => {
  const commonSettings = `**Max allowed difference below collection floor for offers**: ${maxOfferFloorDifference}%.\n\n**Allowed marketplaces**: ${marketplaces
    .filter(({ id }) => allowedMarketplaces.includes(id))
    .map(({ name }) => name)
    .join(", ")}\n\n**Allowed NFT events**: ${nftEvents
    .filter(({ id }) => allowedEvents.includes(id))
    .map(({ name }) => name)
    .join(", ")}`;
  if (nickname != null) {
    return `Settings for alert "**${nickname}**" ${
      address ? `(${address})` : ""
    }:\n\n${commonSettings}`;
  }

  if (address != null) {
    return `Settings for alert with address **${address}**:\n\n${commonSettings}`;
  }

  return `Account settings:\n\n${
    alertLimit ? `**Wallet alert limit**: ${alertLimit}.\n\n` : ""
  }${commonSettings}`;
};

const getSettings = async (dbClient, interaction) => {
  const {
    guildId,
    user: { id: discordId },
  } = interaction;
  const alert = interaction.options.getString("alert");
  const address = isValidAddress(alert) ? alert : null;
  const nickname = isValidNickname(alert) ? alert : null;
  if (address != null) {
    const { result, objects: alerts } = await dbClient
      .getUserAlerts({ discordId })
      .then(({ result, objects }) => {
        const alertByAddress = objects.find(
          ({ address: address1 }) => address1 === address
        );
        if (result === "success" && alertByAddress == null) {
          return dbClient.getUserAlerts({
            discordId: guildId,
          });
        }

        return { result, objects: [alertByAddress] };
      });
    return {
      result,
      object: alerts.find(({ address: address1 }) => address1 === address),
    };
  }

  if (nickname != null) {
    const { result, objects } = await dbClient
      .getAlertsByNickname({ discordId, nickname })
      .then(({ result, objects }) => {
        if (result === "success" && objects.length === 0) {
          return dbClient.getAlertsByNickname({
            discordId: guildId,
            nickname,
          });
        }

        return { result, objects };
      });
    return { result, object: objects ? objects[0] : null };
  }

  return dbClient
    .getUserByDiscordId({ discordId })
    .then(({ result, object }) => {
      if (result === "success" && object == null) {
        return dbClient.getUserByDiscordId({
          discordId: guildId,
        });
      }

      return { result, object };
    });
};

const handleSettings = async ({ dbClient, interaction }) => {
  await interaction.deferReply({
    content: "Fetching your settings...",
    ephemeral: true,
  });
  const alertOption = interaction.options.getString("alert");
  const { result, object } = await getSettings(dbClient, interaction);
  switch (result) {
    case "success":
      return interaction.editReply({
        content:
          object == null && alertOption != null
            ? `You have no alert set up for "${alertOption}"`
            : describeSettings(object),
        ephemeral: true,
      });
    case "missing-user":
    default:
      return interaction.editReply({
        content: `You don't have any settings yet. Please create an alert to get started.`,
        ephemeral: true,
      });
  }
};

const handleSetAllowedMarketplaces = async ({ dbClient, interaction }) => {
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const { object: settings } = await getSettings(dbClient, interaction);
  const { allowedMarketplaces } = settings || {
    allowedMarketplaces: allMarketplaceIds,
  };
  const alert = interaction.options.getString("alert");
  const customId = `allowedmarketplaces/${alert}`;
  const row = new MessageActionRow().addComponents(
    new MessageSelectMenu()
      .setCustomId(customId)
      .setMinValues(1)
      .addOptions(
        marketplaces.map(({ id, name }) => ({
          label: name,
          default: allowedMarketplaces.includes(id),
          value: id,
        }))
      )
  );

  return interaction.editReply({
    content: "Choose the marketplaces you wish to receive alerts from.",
    components: [row],
    ephemeral: true,
  });
};

const handleSetAllowedEvents = async ({ dbClient, interaction }) => {
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const { object: settings } = await getSettings(dbClient, interaction);
  const { allowedEvents } = settings || {
    allowedMarketplaces: allEventIds,
  };
  const alert = interaction.options.getString("alert");
  const customId = `allowedevents/${alert}`;
  const row = new MessageActionRow().addComponents(
    new MessageSelectMenu()
      .setCustomId(customId)
      .setMinValues(1)
      .addOptions(
        nftEvents.map(({ id, name }) => ({
          label: name,
          default: allowedEvents.includes(id),
          value: id,
        }))
      )
  );

  return interaction.editReply({
    content: "Choose the NFT events you wish to be alerted of.",
    components: [row],
    ephemeral: true,
  });
};

const handleUpdatePreferencesResponse = async (interaction, result, object) => {
  if (result === "success") {
    return interaction.editReply({
      content: `Your preferences have been saved.\n\n${describeSettings(
        object
      )}`,
      ephemeral: true,
    });
  }

  if (result === "missing-alert") {
    return interaction.editReply({
      content: "You haven't created any alerts for that address.",
      ephemeral: true,
    });
  }

  return interaction.editReply({
    content:
      "There was an error updating your preferences. Please try again later.",
    ephemeral: true,
  });
};

const handleSetMaxOfferFloorDifference = async ({ dbClient, interaction }) => {
  const {
    guildId,
    user: { id: discordId },
    memberPermissions,
  } = interaction;
  const maxOfferFloorDifference = interaction.options.getNumber("percentage");
  const alert = interaction.options.getString("alert");
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const address = isValidAddress(alert) ? alert : null;
  const nickname = isValidNickname(alert) ? alert : null;

  const { result, object } = await dbClient
    .setMaxFloorDifference({
      discordId,
      maxOfferFloorDifference,
      address,
      nickname,
    })
    .then(({ result, object }) => {
      if (
        (result === "missing-user" || result === "missing-alert") &&
        memberPermissions.has("ADMINISTRATOR")
      ) {
        return dbClient.setMaxFloorDifference({
          discordId: guildId,
          maxOfferFloorDifference,
          address,
          nickname,
        });
      }

      return { result, object };
    });
  return handleUpdatePreferencesResponse(interaction, result, {
    ...object,
    address,
    nickname,
  });
};

const handleSetNickname = async ({ dbClient, interaction }) => {
  const {
    guildId,
    user: { id: discordId },
    memberPermissions,
  } = interaction;
  const nickname = interaction.options.getString("nickname");
  const address = interaction.options.getString("address");
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  if (!isValidAddress(address)) {
    return interaction.editReply({
      content: `Address "${address}" is invalid. Please introduce a valid address.`,
      ephemeral: true,
    });
  }

  if (!isValidNickname(nickname)) {
    return interaction.editReply({
      content: `Nickname "${nickname}" contains spaces. Please, remove the spaces and try again.`,
      ephemeral: true,
    });
  }

  const { result, object } = await dbClient
    .setAlertNickname({
      discordId,
      address,
      nickname,
    })
    .then(({ result, object }) => {
      if (
        result === "missing-alert" &&
        memberPermissions.has("ADMINISTRATOR")
      ) {
        return dbClient.setAlertNickname({
          discordId: guildId,
          address,
          nickname,
        });
      }

      return { result, object };
    });
  return handleUpdatePreferencesResponse(interaction, result, {
    ...object,
    address,
    nickname,
  });
};

const handleCommand = async (args) => {
  const { interaction } = args;
  switch (interaction.commandName) {
    case "listalerts":
      return handleListAlerts(args);
    case "walletalert":
      return handleWalletAlert(args);
    case "collectionalert":
      return handleCollectionAlert(args);
    case "deletealert":
      return handleDeleteAlert(args);
    case "settings":
      return handleSettings(args);
    case "setallowedmarketplaces":
      return handleSetAllowedMarketplaces(args);
    case "setallowedevents":
      return handleSetAllowedEvents(args);
    case "setmaxofferfloordifference":
      return handleSetMaxOfferFloorDifference(args);
    case "setnickname":
      return handleSetNickname(args);
    case "help":
    default:
      return interaction.reply({
        content:
          "To get personal notifications about a wallet's activity, please use the /walletalert command. To get channel-wide alerts for a collection, use the /collectionalert command. To delete an alert, use the /deletealert command.",
        ephemeral: true,
      });
  }
};

const handleAllowedMarketplacesPick = async ({
  dbClient,
  interaction,
  alert,
}) => {
  const {
    guildId,
    user: { id: discordId },
    values: allowedMarketplaces,
    memberPermissions,
  } = interaction;
  await interaction.deferReply({
    content: "Updating your preferences...",
    ephemeral: true,
  });
  const address = isValidAddress(alert) ? alert : null;
  const nickname = isValidNickname(alert) ? alert : null;
  const { result, object } = await dbClient
    .setAllowedMarketplaces({
      discordId,
      allowedMarketplaces,
      address,
      nickname,
    })
    .then(({ result, object }) => {
      if (
        (result === "missing-user" || result === "missing-alert") &&
        memberPermissions.has("ADMINISTRATOR")
      ) {
        return dbClient.setAllowedMarketplaces({
          discordId: guildId,
          allowedMarketplaces,
          address,
          nickname,
        });
      }

      return { result, object };
    });
  return handleUpdatePreferencesResponse(interaction, result, {
    ...object,
    address,
    nickname,
  });
};

const handleAllowedEventsPick = async ({ dbClient, interaction, alert }) => {
  const {
    guildId,
    user: { id: discordId },
    values: allowedEvents,
    memberPermissions,
  } = interaction;
  await interaction.deferReply({
    content: "Updating your preferences...",
    ephemeral: true,
  });
  const address = isValidAddress(alert) ? alert : null;
  const nickname = isValidNickname(alert) ? alert : null;
  const { result, object } = await dbClient
    .setAllowedEvents({
      discordId,
      allowedEvents,
      address,
      nickname,
    })
    .then(({ result, object }) => {
      if (
        (result === "missing-user" || result === "missing-alert") &&
        memberPermissions.has("ADMINISTRATOR")
      ) {
        return dbClient.setAllowedEvents({
          discordId: guildId,
          allowedEvents,
          address,
          nickname,
        });
      }

      return { result, object };
    });
  return handleUpdatePreferencesResponse(interaction, result, {
    ...object,
    address,
    nickname,
  });
};

const handleSelectMenu = async (args) => {
  const {
    interaction: { customId },
  } = args;
  const [menuType, alertString] = customId.split("/");
  const alert = alertString === "null" ? null : alertString;
  switch (menuType) {
    case "allowedevents":
      return handleAllowedEventsPick({ ...args, alert });
    case "allowedmarketplaces":
    default:
      return handleAllowedMarketplacesPick({ ...args, alert });
  }
};

export default async (clients, interaction) => {
  const args = { ...clients, interaction };
  if (interaction.isCommand() && !interaction.replied) {
    try {
      return await handleCommand(args);
    } catch (error) {
      logError(`Error handling user command: ${error.toString()}`);
      return Promise.resolve();
    }
  }

  if (interaction.isSelectMenu()) {
    try {
      return await handleSelectMenu(args);
    } catch (error) {
      logError(`Error handling select menu: ${error.toString()}`);
      return Promise.resolve();
    }
  }

  return Promise.resolve();
};
