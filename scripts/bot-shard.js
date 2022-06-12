/*
 * This is the main script to run the Flipance bot. It coordinates all the
different modules, polling offers, collection floors and user's tokens and also
listens to blockchain events.
 */

import path from "path";
import dotenv from "dotenv";
import logError from "../src/log-error.js";
import { createDbClient } from "../src/database/index.js";
import createBotClient from "../src/discord/create-bot-client.js";
import sleep from "../src/sleep.js";
import minimist from "minimist";

dotenv.config({ path: path.resolve(".env") });

const argv = minimist(process.argv.slice(2));
const { shardId = 0, totalShards = 1 } = argv;

// Milliseconds spent waiting between each poll for NFT events from the DB.
// Should at least match and exceed Ethereum's block time.
const DELAY_BETWEEN_POLLS = 20 * 1000;

// After how many polls the Discord client should reset.
// This is a preventive measure against silent disconnects.
const POLLS_BETWEEN_RESETS = 100;

const minutesAgo = (minutes = 1) =>
  new Date(new Date().setMinutes(new Date().getMinutes() - minutes));

/**
 * This function takes as parameter already-configured clients and is in
 * charge of monitoring blockchain events on the target marketplaces and
 * notifying users/servers of these events.
 * @param {Object} params
 * @param {Object} params.dbClient - The initialized database client.
 */
const pollNFTEvents = async ({
  botClient,
  dbClient,
  lastPollTime = minutesAgo(1),
  currentPolls = 0,
}) => {
  const { objects: nftEvents } = await dbClient.getWatchedNFTEvents({
    createdAt: lastPollTime,
  });
  const newPollTime = new Date();
  const myEvents = nftEvents.filter(({ id }) => id % totalShards === shardId);
  myEvents.forEach((event) => {
    botClient.emit("nftEvent", event);
  });
  await sleep(DELAY_BETWEEN_POLLS);
  if (currentPolls < POLLS_BETWEEN_RESETS) {
    pollNFTEvents({
      botClient,
      dbClient,
      lastPollTime: newPollTime,
      currentPolls: currentPolls + 1,
    });
  } else {
    botClient.destroy();
    const newBotClient = await createBotClient({
      dbClient,
      shardId,
      totalShards,
    });
    pollNFTEvents({
      botClient: newBotClient,
      dbClient,
      lastPollTime: newPollTime,
      currentPolls: 0,
    });
  }
};

const start = async () => {
  console.log(
    `Starting shard client with id ${shardId}, total shards ${totalShards}`
  );
  const dbClient = await createDbClient();
  const botClient = await createBotClient({
    dbClient,
    shardId,
    totalShards,
  });
  pollNFTEvents({ dbClient, botClient });
};

start();

process.on("unhandledRejection", (error) => {
  console.log(error);
  logError(`Unhandled promise rejection: ${error.toString()}`);
  process.exit(-1);
});

process.on("uncaughtException", (error) => {
  console.log(error);
});