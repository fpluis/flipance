/*
 * This function handles incoming user interactions to create/edit/list alerts
and settings. If the interaction is valid, the database is queried and the
interaction with the user is modified. Since database queries take an indefinite
amount of time, it is crucial to first use _interaction.deferReply_ and then
interaction.editReply instead of interaction.reply because otherwise the
interaction will timeout. See https://discord.js.org/#/docs/discord.js/stable/class/CommandInteraction for reference.
 */

import path from "path";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { utils } from "ethers";
import {
  MessageActionRow,
  MessageSelectMenu,
  // eslint-disable-next-line no-unused-vars
  CommandInteraction,
} from "discord.js";
import { bold } from "@discordjs/builders";
import logMessage from "../log-message.js";

dotenv.config({ path: path.resolve(".env") });

const { MAX_NICKNAME_LENGTH = 50, MARKETPLACES } = process.env;

const allMarketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = allMarketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const allowedMarketplaceIds =
  MARKETPLACES == null ? allMarketplaceIds : MARKETPLACES.split(",");
const marketplaces = allMarketplaces.filter(({ id }) =>
  allowedMarketplaceIds.includes(id)
);

/* Check the address is a valid Ethereum address */
const isValidAddress = (address) => {
  try {
    utils.getAddress(address);
    return true;
  } catch (error) {
    return false;
  }
};

/* This function determines what kind of nicknames are acceptable */
const isValidNickname = (nickname) => nickname != null && !/\s/.test(nickname);

/**
 * Handle the /collectionalert slash command. Only users with the Admin permission in a discord server can create alerts for that server. This function will check that the address and/or nickname are correct and that an alert with the same address/nickname for the server doesn't already exist.
 * @param  {Object} params
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {Object} params.dbClient - The initialized database client.
 * @return {void}
 */
const handleCollectionAlert = async ({
  dbClient,
  discordClient,
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

  const nickname = interaction.options.getString("nickname");
  if (nickname != null && !isValidNickname(nickname)) {
    return interaction.editReply({
      content: `Nickname "${nickname}" contains spaces. Please, remove the spaces and try again.`,
      ephemeral: true,
    });
  }

  // The token id for collection alert is set to an empty string.
  const tokens = [`${address.toLowerCase()}/`];
  const { result } = await dbClient.createAlert({
    userId: user.id,
    discordId,
    type: "collection",
    address,
    tokens,
    nickname,
  });
  const nicknameDescription = nickname
    ? ` with alert nickname "${nickname}"`
    : "";
  switch (result) {
    case "success":
      return discordClient.users.cache
        .get(discordId)
        .send(
          `Notifications for collection "${address}"${nicknameDescription}  enabled. Please don't turn off your DMs on every server we share so we can keep messaging you.`
        )
        .then(() => {
          return interaction.editReply({
            content: `Collection alert successfully created for address ${address}${nicknameDescription}.`,
            ephemeral: true,
          });
        })
        .catch(() => {
          return interaction.editReply({
            content: `Collection alert successfully created for address ${address}${nicknameDescription}.\nYou have your DMs turned off. Please enable DMs on at least one server we share so we can notify you of a wallet's activity.`,
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
        content: `You already have a collection alert for address ${address}.`,
        ephemeral: true,
      });
  }
};

/**
 * Handle the /serveralert slash command. Only users with the Admin permission in a discord server can create alerts for that server. This function will check that the address and/or nickname are correct and that an alert with the same address/nickname for the server doesn't already exist.
 * @param  {Object} params
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {Object} params.dbClient - The initialized database client.
 * @return {void}
 */
const handleServerAlert = async ({ dbClient, discordClient, interaction }) => {
  const {
    guildId: discordId,
    user: { id: userDiscordId },
    channelId,
    memberPermissions,
  } = interaction;
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
      content: `You can only have ${user.alertLimit} server alerts per server. Please remove a server alert on this server to add a new one.`,
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
  const tokens = [`${address.toLowerCase()}/`];
  const { result } = await dbClient.createAlert({
    userId: user.id,
    discordId,
    channelId,
    type: "server",
    address,
    tokens,
    nickname,
  });
  const nicknameDescription = nickname
    ? ` with alert nickname "${nickname}"`
    : "";
  switch (result) {
    case "success":
      return discordClient.users.cache
        .get(userDiscordId)
        .send(
          `Server notifications for "${address}"${nicknameDescription} enabled.`
        )
        .then(() => {
          interaction.editReply({
            content: `Server alert successfully created for address ${address}${nicknameDescription}`,
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
        content: `You already have a server alert for address ${address}.`,
        ephemeral: true,
      });
  }
};

/**
 * Handle the /listalert slash command. Lists both personal alerts for the user and server-wide alerts.
 * @param  {Object} params
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {Object} params.dbClient - The initialized database client.
 * @return {void}
 */
const handleListAlerts = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
    guildId,
  } = interaction;
  await interaction.deferReply({
    content: "Fetching your alerts...",
    ephemeral: true,
  });
  const [{ objects: userAlerts }, { objects: guildAlerts }] = await Promise.all(
    [
      dbClient.getUserAlerts({ discordId }),
      dbClient.getUserAlerts({ discordId: guildId }),
    ]
  );
  if (userAlerts.length === 0 && guildAlerts.length === 0) {
    return interaction.editReply({
      content:
        "You haven't set up any wallet nor collection alerts yet. To create a wallet alert, use the /walletalert command with the wallet address you want to watch. To create a collection alert, use the /collectionalert with the with the collection address you want to watch.",
      ephemeral: true,
    });
  }

  const personalAlertList = userAlerts
    .slice(0, 20)
    .reduce((message, { nickname, address, type }) => {
      const typeDescription =
        type === "wallet" ? `(wallet alert)` : `(collection alert)`;
      const fixedNickname = nickname == null ? "(no nickname)" : bold(nickname);
      return `${message}\n${fixedNickname}: ${address} ${typeDescription}`;
    }, "");
  const collectionAlertList = guildAlerts.reduce(
    (message, { nickname, address }) => {
      const fixedNickname = nickname == null ? "(no nickname)" : bold(nickname);
      return `${message}\n${fixedNickname}: ${address}`;
    },
    ""
  );
  let content;
  if (userAlerts.length === 0) {
    content = `You haven't set up any wallet alerts.\n\n These are the server's alerts:${collectionAlertList}.`;
  } else if (guildAlerts.length === 0) {
    content = `These are your personal alerts:${personalAlertList}.\n\nThere are no server alerts.`;
  } else {
    content = `These are your personal alerts:${personalAlertList}.\n\nThese are the server's collection alerts:${collectionAlertList}.`;
  }

  return interaction.editReply({
    content,
    ephemeral: true,
  });
};

/**
 * Handle the /walletalert slash command. This function will check that the address and/or nickname are correct and that an alert with the same address/nickname for the user doesn't already exist.
 * @param  {Object} params
 * @param  {Object} clients.discordClient - The initialized discord client.
 * @param  {Object} clients.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @return {void}
 */
const handleWalletAlert = async ({ dbClient, discordClient, interaction }) => {
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

  const nickname = interaction.options.getString("nickname");
  if (nickname != null && !isValidNickname(nickname)) {
    return interaction.editReply({
      content: `Nickname "${nickname}" contains spaces. Please, remove the spaces and try again.`,
      ephemeral: true,
    });
  }

  const { result } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address,
    tokens: [],
    nickname,
  });
  const nicknameDescription = nickname
    ? ` with alert nickname "${nickname}"`
    : "";
  switch (result) {
    case "success":
      return discordClient.users.cache
        .get(discordId)
        .send(
          `Notifications for "${address}"${nicknameDescription} enabled. Please don't turn off your DMs on every server we share so we can keep messaging you.`
        )
        .then(() => {
          return interaction.editReply({
            content: `Wallet alert successfully created for address ${address}${nicknameDescription}.`,
            ephemeral: true,
          });
        })
        .catch(() => {
          return interaction.editReply({
            content: `Wallet alert successfully created for address ${address}${nicknameDescription}.\nYou have your DMs turned off. Please enable DMs on at least one server we share so we can notify you of a wallet's activity.`,
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

const handleDeleteAlertResponse = async ({
  discordClient,
  interaction,
  result,
  address,
  nickname,
  alert,
}) => {
  const {
    user: { id: discordId },
  } = interaction;
  const { type } = alert || {};
  const identifier =
    address == null
      ? `with nickname "${nickname}"`
      : `for address "${address}"`;
  const alertDescription =
    type === "server" ? `Server alert` : `Personal alert`;
  switch (result) {
    case "success":
      await discordClient.users.cache
        .get(discordId)
        .send(`${alertDescription} ${identifier} successfully removed.`);
      return interaction.editReply({
        content: `${alertDescription} ${identifier} successfully removed.`,
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

/**
 * Handle the /deletealert slash command. Only users with the Admin permission in a discord server can delete alerts for that server.
 * @param  {Object} params
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {Object} clients.discordClient - The initialized discord client.
 * @param  {Object} params.dbClient - The initialized database client.
 * @return {void}
 */
const handleDeleteAlert = async ({ dbClient, discordClient, interaction }) => {
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

  if (address != null && !isValidAddress(address)) {
    return interaction.editReply({
      content: `Address "${address}" is invalid. Please introduce a valid address.`,
      ephemeral: true,
    });
  }

  if (address != null) {
    const { objects: addressAlerts } = await dbClient.getAlertsByAddress({
      address,
    });
    const conflictingAddresses = addressAlerts.filter(
      ({ discordId: alertDiscordId }) =>
        [discordId, guildId].includes(alertDiscordId)
    );
    // There is both a user and server alert with the same nickname
    if (
      conflictingAddresses.length === 2 &&
      memberPermissions.has("ADMINISTRATOR")
    ) {
      const customId = `deletealert/${address}`;
      const row = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId(customId)
          .setMinValues(1)
          .setMaxValues(1)
          .setPlaceholder("Pick an alert...")
          .addOptions([
            {
              label: "Server alert",
              description: "The server's alert for this address",
              value: "server",
            },
            {
              label: "User alert",
              description: "Your personal alert for this address",
              value: "user",
            },
          ])
      );

      return interaction.editReply({
        content:
          "Two alerts share the same address. Choose which one you want to delete.",
        components: [row],
        ephemeral: true,
      });
    }
  }

  const { result, object } = await dbClient
    .deleteAlert({
      discordId,
      address,
      nickname,
    })
    .then(({ result, object }) => {
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

      return { result, object };
    });
  return handleDeleteAlertResponse({
    discordClient,
    interaction,
    result,
    address,
    nickname,
    alert: object,
  });
};

/**
 * Helper function to turn user/alert settings into a human-readable string
 */
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

/**
 * Helper function to retrieve settings where either the alert or the address are provided as the interaction option "alert". If the "alert" interaction option is a valid Ethereum address, it will attempt to retrieve it from the database. If it is a valid nickname, it will attempt to retrieve a matching alert from the database. Finally, it will attempt to retrieve the user/server settings from the database.
 * @param  {Object} dbClient - The initialized database client.
 * @param  {CommandInteraction} interaction - The user interaction.
 * @return {void}
 */
const getSettings = async (dbClient, interaction) => {
  const {
    guildId,
    user: { id: discordId },
  } = interaction;
  const alert = interaction.options.getString("alert");
  const address = isValidAddress(alert) ? alert.toLowerCase() : null;
  const nickname = isValidNickname(alert) ? alert : null;
  if (address != null) {
    const { result, objects: alerts } = await dbClient
      .getUserAlerts({ discordId })
      .then(({ result, objects }) => {
        const alertByAddress = objects.find(
          ({ address: address1 }) => address1 === address.toLowerCase()
        );
        // If the user doesn't have the alert, query server alerts
        if (result === "success" && alertByAddress == null) {
          return dbClient.getUserAlerts({
            discordId: guildId,
          });
        }

        return { result, objects: [alertByAddress] };
      });
    return {
      result,
      object: alerts.find(
        ({ address: address1 }) => address1 === address.toLowerCase()
      ),
    };
  }

  if (nickname != null) {
    const { result, objects } = await dbClient
      .getAlertsByNickname({ discordId, nickname })
      .then(({ result, objects }) => {
        // If the user doesn't have the alert, query server alerts
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
      // If the user hasn't created any alerts, retrieve the server-wide settings.
      if (result === "success" && object == null) {
        return dbClient.getUserByDiscordId({
          discordId: guildId,
        });
      }

      return { result, object };
    });
};

/**
 * Handle the /settings slash command. Depending on the "alert" interaction option, the settings will be those of a user/server or an alert.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @return {void}
 */
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

/**
 * Handle the /setallowedmarketplaces slash command. Depending on the "alert" interaction option, the modified settings will be those of a user/server or an alert. This function does not modify the settings directly. Instead, it creates a multi select menu on the discord interaction where the user can pick the marketplaces. The function that handles that result is handleAllowedMarketplacesPick.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @return {void}
 */
const handleSetAllowedMarketplaces = async ({ dbClient, interaction }) => {
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const { object: settings } = await getSettings(dbClient, interaction);
  const { allowedMarketplaces } = settings || {
    allowedMarketplaces: allowedMarketplaceIds,
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

/**
 * Handle the /setallowedevents slash command. Depending on the "alert" interaction option, the modified settings will be those of a user/server or an alert. This function does not modify the settings directly. Instead, it creates a multi select menu on the discord interaction where the user can pick the events. The function that handles that result is handleAllowedEventsPick.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @return {void}
 */
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

/*
 * Helper function that replies to the user interaction depending on the result
after attempting a database query.
 */
const handleUpdatePreferencesResponse = async (interaction, result, object) => {
  if (result === "success") {
    return interaction.editReply({
      content: `Your preferences have been saved. Note that you might still see events we had already queued up for you.\n\n${describeSettings(
        object
      )}`,
      ephemeral: true,
    });
  }

  if (["missing-alert", "missing-user"].includes(result)) {
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

/**
 * Handle the /setmaxofferfloordifference slash command. Depending on the "alert" interaction option, the modified settings will be those of a user/server or an alert. The percentage is passed as an interaction option and does not need validation because Discord already checks it is a Number.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @return {void}
 */
const handleSetMaxOfferFloorDifference = async ({ dbClient, interaction }) => {
  const {
    guildId,
    user: { id: discordId },
    memberPermissions,
  } = interaction;
  const maxOfferFloorDifference = interaction.options.getNumber("percentage");
  if (maxOfferFloorDifference < 0 || maxOfferFloorDifference > 100) {
    return interaction.editReply({
      content: "Please specify a positive percentage between 0 and 100.",
      ephemeral: true,
    });
  }

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

/**
 * Handle the /setnickname slash command. If the provided interaction options are correct, and an alert with the provided address exists, then the nickname for that address changes.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @return {void}
 */
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
  if (result === "success") {
    return interaction.editReply({
      content: `Your preferences have been saved. Your new nickname for the alert with address ${address} is now ${nickname}.\n\n${describeSettings(
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

/**
 * Routes the input interaction to its handler, depending on the interaction's commandName.
 * @param  {Object} args
 * @param  {CommandInteraction} args.interaction - The user interaction.
 * @return {void}
 */
const handleCommand = async (args) => {
  const { interaction } = args;
  switch (interaction.commandName) {
    case "listalerts":
      return handleListAlerts(args);
    case "walletalert":
      return handleWalletAlert(args);
    case "collectionalert":
      return handleCollectionAlert(args);
    case "serveralert":
      return handleServerAlert(args);
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

/**
 * Handles the interaction response when a user selects the allowed marketplaces in a Discord SelectMenu. The function handleSetAllowedMarketplaces is the one that handles the initial /setallowedmarketplaces slash command.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {CommandInteraction} params.alert - The "alert" interaction option passed to the original slash command interaction.
 * @return {void}
 */
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

/**
 * Handles the interaction response when a user selects the allowed events in a Discord SelectMenu. The function handleSetAllowedEvents is the one that handles the initial /setallowedevents slash command.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {CommandInteraction} params.alert - The "alert" interaction option passed to the original slash command interaction.
 * @return {void}
 */
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

/**
 * Handles the interaction response when a user selects which of the two alerts with the same address they want to delete. The function handleDeleteAlert is the one that handles the initial /deletelert slash command.
 * @param  {Object} params
 * @param  {Object} params.dbClient - The initialized database client.
 * @param  {CommandInteraction} params.interaction - The user interaction.
 * @param  {CommandInteraction} params.alert - The "alert" interaction option passed to the original slash command interaction.
 * @return {void}
 */
const handleDeleteCollidingAlert = async ({
  dbClient,
  discordClient,
  interaction,
  alert: address,
}) => {
  const {
    guildId,
    user: { id: discordId },
    values,
  } = interaction;
  await interaction.deferReply({
    content: "Deleting your alert...",
    ephemeral: true,
  });
  let response;
  if (values.length === 1 && values.includes("user")) {
    response = await dbClient.deleteAlert({
      discordId,
      address,
    });
  } else {
    response = await dbClient.deleteAlert({
      discordId: guildId,
      address,
    });
  }

  const { result, object } = response;
  return handleDeleteAlertResponse({
    discordClient,
    interaction,
    result,
    address,
    alert: object,
  });
};

/**
 * Routes the SelectMenu interaction to its handler, depending on the select menu "type" which is set within the SelectMenu's custom id. It is necessary to specify the id in this way to pass the interaction option "alert" from the initial interaction to the pick handlers because the latter don't have access to interaction options.
 * @param  {Object} args
 * @param  {CommandInteraction} args.interaction - The user interaction.
 * @return {void}
 */
const handleSelectMenu = async (args) => {
  const {
    interaction: { customId },
  } = args;
  const [menuType, alertString] = customId.split("/");
  const alert = alertString === "null" ? null : alertString;
  switch (menuType) {
    case "deletealert":
      return handleDeleteCollidingAlert({ ...args, alert });
    case "allowedevents":
      return handleAllowedEventsPick({ ...args, alert });
    case "allowedmarketplaces":
    default:
      return handleAllowedMarketplacesPick({ ...args, alert });
  }
};

/**
 * Handle an interaction provided the necessary service clients.
 * @param  {Object} clients
 * @param  {Object} clients.discordClient - The initialized discord client.
 * @param  {Object} clients.dbClient - The initialized database client.
 * @param  {CommandInteraction} interaction - The Discord interaction initiated by
 * the user.
 */
export default async (clients, interaction) => {
  const args = { ...clients, interaction };
  if (interaction.isCommand() && !interaction.replied) {
    try {
      return await handleCommand(args);
    } catch (error) {
      logMessage({
        message: `Error handling user command`,
        level: "error",
        error,
      });
      return Promise.resolve();
    }
  }

  if (interaction.isSelectMenu()) {
    try {
      return await handleSelectMenu(args);
    } catch (error) {
      logMessage({
        message: `Error handling select menu`,
        level: "error",
        error,
      });
      return Promise.resolve();
    }
  }

  return Promise.resolve();
};
