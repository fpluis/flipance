/*
 * This is the main script to run the Flipance bot. It coordinates all the
different modules, polling offers, collection floors and user's tokens and also
listens to blockchain events.
 */

import path from "path";
import dotenv from "dotenv";
import logMessage from "../src/log-message.js";
import { createDbClient } from "../src/database/index.js";
import createBotClient from "../src/discord/create-bot-client.js";
import sleep from "../src/sleep.js";

dotenv.config({ path: path.resolve(".env") });

const { TOTAL_SHARDS, SHARD_ID } = process.env;

const [shardIdFromString] = SHARD_ID.match(/\d$/) || [];
const shardId = shardIdFromString ? Number(shardIdFromString) : 0;
const totalShards = TOTAL_SHARDS ? Number(TOTAL_SHARDS) : 1;
logMessage({
  message: `Shard configuration: ${shardId + 1}/${totalShards}`,
  level: "info",
});

// Milliseconds spent waiting between each poll for NFT events from the DB.
// Should at least match and exceed Ethereum's block time.
const DELAY_BETWEEN_POLLS = 20 * 1000;

// After how many polls the Discord client should reset.
// This is a preventive measure against silent disconnects.
const POLLS_BETWEEN_RESETS = 1000;

const minutesAgo = (minutes = 1) =>
  new Date(new Date().setMinutes(new Date().getMinutes() - minutes));

/**
 * This function takes as parameter already-configured clients and is in
 * charge of monitoring blockchain events on the target marketplaces and
 * notifying users/servers of these events.
 * @param {Object} params
 * @param {Object} params.botClient - The initialized Discord client.
 * @param {Object} params.dbClient - The initialized database client.
 * @param {Date} params.lastPollTime - The date when the database events
 * were last polled.
 * @param {Number} params.currentPolls - The number of times the bot has
 * polled the database without restarting the client.
 * @param {Number} minId - The last event id retrieved, used for pagination.
 */
const pollNFTEvents = async ({
  botClient,
  dbClient,
  lastPollTime = minutesAgo(1),
  currentPolls = 0,
  minId = 0,
}) => {
  const { objects: nftEvents } = await dbClient.getWatchedNFTEvents({
    createdAt: lastPollTime,
    minId,
  });
  const myEvents = nftEvents.reduce((events, { watchers, ...event }) => {
    const myWatchers = watchers.filter(({ discordId }) => {
      // eslint-disable-next-line no-bitwise
      return Math.abs((discordId >> 22) % totalShards) === shardId;
    });
    if (myWatchers.length > 0) {
      return events.concat({ ...event, watchers: myWatchers });
    }

    if (myWatchers.length !== watchers.length) {
      logMessage({
        message: "Some watchers were filtered",
        event,
        watchers,
        myWatchers,
        totalShards,
        shardId,
        level: "debug",
      });
    }

    return events;
  }, []);
  const lastPolledId =
    nftEvents.length > 0 ? Math.max(...nftEvents.map(({ id }) => id)) : minId;
  const [{ startsAt: newPollTime }] =
    nftEvents.length > 0
      ? nftEvents.sort(
          ({ startsAt: startsAt1 }, { startsAt: startsAt2 }) =>
            startsAt1 - startsAt2
        )
      : [{ startsAt: new Date() }];
  logMessage({
    message: `Received ${nftEvents.length} events (I handle ${
      myEvents.length
    }) since date ${lastPollTime.toISOString()}.`,
  });
  botClient.setMaxEventAge(lastPollTime);
  myEvents.forEach((event) => {
    botClient.emit("nftEvent", event);
  });

  await sleep(DELAY_BETWEEN_POLLS);
  if (currentPolls < POLLS_BETWEEN_RESETS) {
    return pollNFTEvents({
      botClient,
      dbClient,
      lastPollTime: newPollTime,
      currentPolls: currentPolls + 1,
      minId: lastPolledId,
    });
  }

  botClient.destroy();
  const newBotClient = await createBotClient({
    dbClient,
    shardId,
    totalShards,
  });
  return pollNFTEvents({
    botClient: newBotClient,
    dbClient,
    lastPollTime: newPollTime,
    currentPolls: 0,
    minId: lastPolledId,
  });
};

const start = async () => {
  const dbClient = await createDbClient();
  const botClient = await createBotClient({
    dbClient,
    shardId,
    totalShards,
  });
  return pollNFTEvents({ dbClient, botClient });
};

start();

process.on("unhandledRejection", (error) => {
  logMessage({ message: `Unhandled promise rejection`, level: "error", error });
  process.exit(-1);
});

process.on("uncaughtException", (error) => {
  logMessage({ message: `Uncaught exception`, level: "error", error });
  process.exit(-1);
});
