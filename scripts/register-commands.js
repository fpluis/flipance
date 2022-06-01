/* eslint-disable no-await-in-loop */
/*
  This script is used to update every Discord server where the bot is installed
  whenever the slash commands change.
  Note: Users will only see updated commands after relogging
*/

import path from "path";
import dotenv from "dotenv";
import { Client, Intents } from "discord.js";
import registerCommands from "../src/discord/register-commands.js";

dotenv.config({ path: path.resolve(".env") });

const { DISCORD_BOT_TOKEN, DISCORD_BOT_TOKEN_TEST } = process.env;

const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
const [, , testArg] = process.argv;
discordClient.login(
  testArg === "test" ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN
);

discordClient.on("ready", async () => {
  let index = 0;
  const guildIds = discordClient.guilds.cache.map((guild) => guild.id);
  while (index < guildIds.length) {
    const guildId = guildIds[index];
    await registerCommands(guildId);
    index += 1;
  }

  discordClient.destroy();
  console.log(`Done`);
});
