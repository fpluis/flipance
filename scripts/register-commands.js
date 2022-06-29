/* eslint-disable no-await-in-loop */
/*
  This script is used to update every Discord server where the bot is installed whenever the slash commands change.
  Note: Users may only see updated commands after relogging
*/

import path from "path";
import dotenv from "dotenv";
import { Client, Intents } from "discord.js";
import registerCommands from "../src/discord/register-commands.js";
import minimist from "minimist";
import logMessage from "../src/log-message.js";

dotenv.config({ path: path.resolve(".env") });

const { DISCORD_BOT_TOKEN, DISCORD_BOT_TOKEN_TEST } = process.env;
const argv = minimist(process.argv.slice(2));

const discordClient = new Client({ intents: [Intents.FLAGS.GUILDS] });
discordClient.login(argv.test ? DISCORD_BOT_TOKEN_TEST : DISCORD_BOT_TOKEN);

discordClient.on("ready", async () => {
  let index = 0;
  const guildIds = discordClient.guilds.cache.map((guild) => guild.id);
  while (index < guildIds.length) {
    const guildId = guildIds[index];
    await registerCommands(guildId);
    index += 1;
  }

  discordClient.destroy();
  logMessage({
    message: `Registered commands on ${guildIds.length} servers`,
    level: "info",
  });
});
