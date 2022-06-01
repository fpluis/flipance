/*
 * This function registers all of the bot's commands on a Discord server.
 * It needs to be called whenever the bot joins a server and also whenever
 * the commands change. If that is the case, use the register-commands script.
 * Note: Users will only see updated commands after relogging.
 */

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
    .setDescription("Provides information about the bot and its commands."),
  new SlashCommandBuilder()
    .setName("listalerts")
    .setDescription(
      "List your active wallet alerts on this server and the server's collection alerts."
    ),
  new SlashCommandBuilder()
    .setName("walletalert")
    .setDescription(
      "Creates an alert to track a wallet's NFT activity across marketplaces."
    )
    .addStringOption((option) =>
      option
        .setName("address")
        .setDescription("The Ethereum address of the wallet you want to track.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription(
          `Wallet's nickname (must have between 1-${MAX_NICKNAME_LENGTH} characters, no spaces).`
        )
    ),
  new SlashCommandBuilder()
    .setName("collectionalert")
    .setDescription(
      "Notifies you of a collection's NFT activity across marketplaces."
    )
    .addStringOption((option) =>
      option
        .setName("address")
        .setDescription(
          "The Ethereum address of the collection you want to track."
        )
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription(
          `Collection's nickname (must have between 1-${MAX_NICKNAME_LENGTH} characters, no spaces).`
        )
    ),
  new SlashCommandBuilder()
    .setName("deletealert")
    .setDescription(
      "Deletes the alert for the specified collection address or nickname."
    )
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription("Alert's nickname or address.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Display your current settings.")
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert's nickname or address. Leave empty to see your account settings."
        )
    ),
  new SlashCommandBuilder()
    .setName("setallowedmarketplaces")
    .setDescription("Choose the marketplaces you wish to receive alerts from.")
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert's nickname or address. Leave empty to change your account settings."
        )
    ),
  new SlashCommandBuilder()
    .setName("setallowedevents")
    .setDescription("Choose the NFT events you wish to be alerted of.")
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert's nickname or address. Leave empty to change your account settings."
        )
    ),
  new SlashCommandBuilder()
    .setName("setmaxofferfloordifference")
    .setDescription(
      "Set the maximum deviation from the collection's floor that an offer may have."
    )
    .addNumberOption((option) =>
      option
        .setName("percentage")
        .setDescription("Difference from the floor as a percentage i.e. '20'.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("alert")
        .setDescription(
          "Alert's nickname or address. Leave empty to change your account settings."
        )
    ),
  new SlashCommandBuilder()
    .setName("setnickname")
    .setDescription("Set an alert's nickname.")
    .addStringOption((option) =>
      option
        .setName("address")
        .setDescription("The alert's address.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("nickname")
        .setDescription("The new nickname for the alert.")
        .setRequired(true)
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
