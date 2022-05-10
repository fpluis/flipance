import { readFileSync } from "fs";
import { utils } from "ethers";
import { getAddressNFTs } from "../blockchain/index.js";
import { MessageActionRow, MessageSelectMenu } from "discord.js";

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const isValidAddress = (address) => {
  try {
    utils.getAddress(address);
    return true;
  } catch (error) {
    return false;
  }
};

const handleCollectionAlert = async ({ dbClient, interaction }) => {
  const { guildId: discordId, channelId, memberPermissions } = interaction;
  if (!memberPermissions.has("ADMINISTRATOR")) {
    return interaction.reply({
      content:
        "You need administrator permissions to add a collection watch to this server",
      ephemeral: true,
    });
  }

  const currentAlerts = await dbClient.getUserAlerts(discordId);
  if (currentAlerts.length >= 1) {
    return interaction.reply({
      content:
        "You can only have one collection alert per server. Please remove the current collection alert on this server to add a new one.",
      ephemeral: true,
    });
  }

  const address = interaction.options.getString("address");
  if (!isValidAddress(address)) {
    return interaction.reply({
      content: `Address "${address}" is invalid. Please introduce a valid address`,
      ephemeral: true,
    });
  }

  const result = await dbClient.createAlert({
    discordId,
    channelId,
    type: "collection",
    address,
  });
  switch (result) {
    case "success":
      return interaction.reply({
        content: `Alert successfully created for address ${address}`,
        ephemeral: true,
      });
    case "duplicate":
    default:
      return interaction.reply({
        content: `You already have a collection alert for address ${address}`,
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
  const [currentAlerts, guildAlerts] = await Promise.all([
    dbClient.getUserAlerts(discordId),
    dbClient.getUserAlerts(guildId),
  ]);
  console.log(
    `Wallet ${discordId} alerts: ${JSON.stringify(
      currentAlerts
    )}; Guild (${guildId}) alerts: ${JSON.stringify(guildAlerts)}`
  );

  if (currentAlerts.length === 0 && guildAlerts.length === 0) {
    return interaction.editReply({
      content:
        "You haven't set up any alerts yet. To create a wallet alert, use the /walletalert command with the wallet address you want to watch. To create a collection alert, use the /collectionalert with the with the collection address you want to watch.",
      ephemeral: true,
    });
  }

  const walletAlertList = currentAlerts.reduce((message, { address }) => {
    return `${message}\n${address}`;
  }, "");
  const collectionAlertList = guildAlerts.reduce((message, { address }) => {
    return `${message}\n${address}`;
  }, "");
  let content;
  if (currentAlerts.length === 0) {
    content = `You have not set up any wallet alerts. These are the server's alerts:${walletAlertList}.`;
  } else if (guildAlerts.length === 0) {
    content = `These are your current wallet alerts:${walletAlertList}. There are no server alerts.`;
  } else {
    content = `These are your current wallet alerts:${walletAlertList}.\n\nThese are the server's current collection alerts:${collectionAlertList}`;
  }

  return interaction.editReply({
    content,
    ephemeral: true,
  });
};

const handleWalletAlert = async ({
  dbClient,
  discordClient,
  moralisClient,
  interaction,
}) => {
  const {
    user: { id: discordId },
  } = interaction;
  const currentAlerts = await dbClient.getUserAlerts(discordId);
  const { walletAlertLimit } = await dbClient.getUserByDiscordId(discordId);
  if (currentAlerts.length >= walletAlertLimit) {
    return interaction.reply({
      content:
        "You have reached your alert limit. Please remove one of your existing alerts to add more alerts.",
      ephemeral: true,
    });
  }

  const address = interaction.options.getString("address");
  if (!isValidAddress(address)) {
    return interaction.reply({
      content: `Address "${address}" is invalid. Please introduce a valid address`,
      ephemeral: true,
    });
  }

  let replied = false;
  discordClient.users.cache
    .get(discordId)
    .send(
      `Notifications for "${address}" enabled. Please don't turn off your DMs on every server we share so I can keep messaging you.`
    )
    .catch(() => {
      interaction.reply({
        content: `You have your DMs turned off. Please enable DMs on at least one server we share so I can notify you of a wallet's activity.`,
        ephemeral: true,
      });
      replied = true;
    });

  const result = await dbClient.createAlert({
    discordId,
    type: "wallet",
    address,
  });
  switch (result) {
    case "success":
      getAddressNFTs(moralisClient, [address])
        .then((tokens) => {
          console.log(
            `Tokens for address ${address}: ${JSON.stringify(tokens)}`
          );
          dbClient.addUserAddress({
            discordId,
            addresses: [address],
            tokens,
          });
        })
        .catch((error) => {
          console.log(`Error fetching NFTs for address ${address}`, error);
          dbClient.addUserAddress({
            discordId,
            addresses: [address],
            tokens: [],
          });
        });

      if (!replied) {
        return interaction.reply({
          content: `Alert successfully created for address ${address}`,
          ephemeral: true,
        });
      }

      return result;
    case "duplicate":
    default:
      if (!replied) {
        return interaction.reply({
          content: `You already have an alert for address ${address}`,
          ephemeral: true,
        });
      }

      return result;
  }
};

const handleDeleteWallet = async ({
  dbClient,
  discordClient,
  moralisClient,
  interaction,
}) => {
  const {
    user: { id: discordId },
  } = interaction;
  const address = interaction.options.getString("address");
  if (!isValidAddress(address)) {
    return interaction.reply({
      content: `Address "${address}" is invalid. Please introduce a valid address`,
      ephemeral: true,
    });
  }

  discordClient.users.cache
    .get(discordId)
    .send(`Notifications for "${address}" are now turned off.`)
    .catch(() => {});

  const result = await dbClient.deleteAlert({ discordId, address });
  switch (result) {
    case "no-alert":
      return interaction.reply({
        content: `You have no alert set up for address ${address}`,
        ephemeral: true,
      });
    case "success":
    default:
      getAddressNFTs(moralisClient, [address]).then((tokens) => {
        console.log(`Tokens for address ${address}: ${JSON.stringify(tokens)}`);
        dbClient.deleteUserAddress({ discordId, address, tokens });
      });
      return interaction.reply({
        content: `Alert successfully removed for address ${address}`,
        ephemeral: true,
      });
  }
};

const handleDeleteCollection = async ({ dbClient, interaction }) => {
  const { guildId: discordId, memberPermissions } = interaction;
  if (!memberPermissions.has("ADMINISTRATOR")) {
    return interaction.reply({
      content: "You need administrator permission to remove collection alerts",
      ephemeral: true,
    });
  }

  const address = interaction.options.getString("address");
  if (!isValidAddress(address)) {
    return interaction.reply({
      content: `Address "${address}" is invalid. Please introduce a valid address`,
      ephemeral: true,
    });
  }

  const result = await dbClient.deleteAlert({ discordId, address });
  switch (result) {
    case "no-alert":
      return interaction.reply({
        content: `You have no alert set up for address ${address}`,
        ephemeral: true,
      });
    case "success":
    default:
      return interaction.reply({
        content: `Alert successfully removed for address ${address}`,
        ephemeral: true,
      });
  }
};

const describeSettings = ({
  walletAlertLimit,
  maxOfferFloorDifference,
  allowedMarketplaces,
  allowedEvents,
}) =>
  `**Wallet alert limit**: ${walletAlertLimit}.\n\n**Max allowed difference below collection floor for offers**: ${maxOfferFloorDifference}%.\n\n**Allowed marketplaces**: ${marketplaces
    .filter(({ id }) => allowedMarketplaces.includes(id))
    .map(({ name }) => name)
    .join(", ")}\n\n**Allowed NFT events**: ${nftEvents
    .filter(({ id }) => allowedEvents.includes(id))
    .map(({ name }) => name)
    .join(", ")}`;

const handleSettings = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
  } = interaction;
  console.log(`Discord id: ${discordId}`);
  await interaction.deferReply({
    content: "Fetching your settings...",
    ephemeral: true,
  });
  const settings = await dbClient.getUserByDiscordId(discordId);
  return interaction.editReply({
    content: describeSettings(settings),
    ephemeral: true,
  });
};

const handleSetAllowedMarketplaces = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
  } = interaction;
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const { allowedMarketplaces } = await dbClient.getUserByDiscordId(discordId);
  console.log(
    `Allowed marketplaces for user ${discordId}: ${JSON.stringify(
      allowedMarketplaces
    )}`
  );
  const row = new MessageActionRow().addComponents(
    new MessageSelectMenu()
      .setCustomId("allowedmarketplaces")
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
    content: "Choose the marketplaces you wish to receive alerts from",
    components: [row],
    ephemeral: true,
  });
};

const handleSetAllowedEvents = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
  } = interaction;
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const { allowedEvents } = await dbClient.getUserByDiscordId(discordId);
  console.log(
    `Allowed events for user ${discordId}: ${JSON.stringify(allowedEvents)}`
  );
  const row = new MessageActionRow().addComponents(
    new MessageSelectMenu()
      .setCustomId("allowedevents")
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
    content: "Choose the NFT events you wish to be alerted of",
    components: [row],
    ephemeral: true,
  });
};

const handleUpdatePreferencesResponse = async (interaction, result) => {
  if (result === "success") {
    return interaction.editReply({
      content: "Your preferences have been saved",
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
    user: { id: discordId },
  } = interaction;
  const maxOfferFloorDifference = interaction.options.getNumber("percentage");
  await interaction.deferReply({
    content: "Fetching your preferences...",
    ephemeral: true,
  });
  const result = await dbClient.setMaxFloorDifference({
    discordId,
    maxOfferFloorDifference,
  });
  return handleUpdatePreferencesResponse(interaction, result);
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
    case "deletewalletalert":
      return handleDeleteWallet(args);
    case "deletecollectionalert":
      return handleDeleteCollection(args);
    case "settings":
      return handleSettings(args);
    case "setallowedmarketplaces":
      return handleSetAllowedMarketplaces(args);
    case "setallowedevents":
      return handleSetAllowedEvents(args);
    case "setmaxofferfloordifference":
      return handleSetMaxOfferFloorDifference(args);
    case "help":
    default:
      return interaction.reply({
        content:
          "To get personal notifications about a wallet's activity, please use the /walletalert command. To get channel-wide alerts for a collection, use the /collectionalert command. To delete an alert, use the /deletealert command.",
        ephemeral: true,
      });
  }
};

const handleAllowedMarketplacesPick = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
    values: allowedMarketplaces,
  } = interaction;
  await interaction.deferReply({
    content: "Updating your preferences...",
    ephemeral: true,
  });
  const result = await dbClient.setAllowedMarketplaces({
    id: discordId,
    allowedMarketplaces,
  });
  return handleUpdatePreferencesResponse(interaction, result);
};

const handleAllowedEventsPick = async ({ dbClient, interaction }) => {
  const {
    user: { id: discordId },
    values: allowedEvents,
  } = interaction;
  await interaction.deferReply({
    content: "Updating your preferences...",
    ephemeral: true,
  });
  const result = await dbClient.setAllowedEvents({
    id: discordId,
    allowedEvents,
  });
  return handleUpdatePreferencesResponse(interaction, result);
};

const handleSelectMenu = async (args, interaction) => {
  const { customId } = interaction;
  switch (customId) {
    case "allowedevents":
      return handleAllowedEventsPick(args);
    case "allowedmarketplaces":
    default:
      return handleAllowedMarketplacesPick(args);
  }
};

export default async (clients, interaction) => {
  const args = { ...clients, interaction };
  if (interaction.isCommand() && !interaction.replied) {
    try {
      return await handleCommand(args);
    } catch (error) {
      console.log(error);
      return Promise.resolve();
    }
  }

  if (interaction.isSelectMenu()) {
    try {
      return await handleSelectMenu(args);
    } catch (error) {
      console.log(error);
      return Promise.resolve();
    }
  }

  return Promise.resolve();
};
