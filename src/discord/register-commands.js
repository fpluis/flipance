import path from "path";
import dotenv from "dotenv";
import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";

dotenv.config({ path: path.resolve(".env") });

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_ID_TEST,
  DISCORD_BOT_TOKEN,
  DISCORD_BOT_TOKEN_TEST,
  MAX_NICKNAME_LENGTH = 50,
} = process.env;
const [, , testArg] = process.argv;

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Provides information about the bot's command"),
  new SlashCommandBuilder()
    .setName("listalerts")
    .setDescription("List your active wallet alerts"),
  new SlashCommandBuilder()
    .setName("walletalert")
    .setDescription(
      "Notifies you of a wallet's NFT activity across marketplaces"
    )
    .addStringOption((option) =>
      option
        .setName("address")
        .setDescription("Wallet's address")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription(
          `Wallet's nickname (1-${MAX_NICKNAME_LENGTH} characters, no spaces)`
        )
    ),
  new SlashCommandBuilder()
    .setName("collectionalert")
    .setDescription(
      "Notifies you of a collection's NFT activity across marketplaces"
    )
    .addStringOption((option) =>
      option
        .setName("address")
        .setDescription("Collection's address")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription(
          `Collection's  nickname (1-${MAX_NICKNAME_LENGTH} characters, no spaces)`
        )
    ),
  new SlashCommandBuilder()
    .setName("deletecollectionalert")
    .setDescription(
      "Deletes the server's alert for the specified collection address or nickname"
    )
    .addStringOption((option) =>
      option.setName("address").setDescription("Address being watched")
    )
    .addStringOption((option) =>
      option.setName("nickname").setDescription(`Wallet's nickname`)
    ),
  new SlashCommandBuilder()
    .setName("deletewalletalert")
    .setDescription(
      "Deletes your alert for the specified address or wallet nickname"
    )
    .addStringOption((option) =>
      option.setName("address").setDescription("Address being watched")
    )
    .addStringOption((option) =>
      option.setName("nickname").setDescription(`Collection's nickname`)
    ),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Display your current settings")
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert nickname or address. Leave empty to see your account-wide settings"
        )
    ),
  new SlashCommandBuilder()
    .setName("setallowedmarketplaces")
    .setDescription("Choose the marketplaces you wish to receive alerts from")
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert nickname or address which you want to edit. Leave empty to change your account-wide settings"
        )
    ),
  new SlashCommandBuilder()
    .setName("setallowedevents")
    .setDescription("Choose the NFT events you wish to be alerted of")
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert nickname or address which you want to edit. Leave empty to change your account-wide settings"
        )
    ),
  new SlashCommandBuilder()
    .setName("setmaxofferfloordifference")
    .setDescription(
      "Set the maximum deviation from the collection's floor that an offer may have"
    )
    .addNumberOption((option) =>
      option
        .setName("percentage")
        .setDescription("Difference from the floor as percentage i.e. '20'")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert nickname or address which you want to edit. Leave empty to change your account-wide settings"
        )
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: "9" }).setToken(
  testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
);

export default async (guildId) => {
  const clientId =
    testArg === "test" ? DISCORD_CLIENT_ID_TEST : DISCORD_CLIENT_ID;
  return rest
    .put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    })
    .then(() =>
      console.log(`Successfully registered application commands on ${guildId}.`)
    )
    .catch((error) =>
      console.log(`Error registering commands on guild ${guildId}:`, error)
    );
};
