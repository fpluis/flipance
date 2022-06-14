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
import EventEmitter from "events";

dotenv.config({ path: path.resolve(".env") });

console.log(`Env: ${JSON.stringify(process.env)}`);

// const argv = minimist(process.argv.slice(2));
const { TOTAL_SHARDS = 1, SHARD_ID = TOTAL_SHARDS - 1, HOSTNAME } = process.env;

let shardId = SHARD_ID;
let totalShards = TOTAL_SHARDS;

console.log(`Initiating bot shard ${shardId}/${totalShards}`);
// Milliseconds spent waiting between each poll for NFT events from the DB.
// Should at least match and exceed Ethereum's block time.
const DELAY_BETWEEN_POLLS = 20 * 1000;

// After how many polls the Discord client should reset.
// This is a preventive measure against silent disconnects.
const POLLS_BETWEEN_RESETS = 100;

const minutesAgo = (minutes = 1) =>
  new Date(new Date().setMinutes(new Date().getMinutes() - minutes));

const createShardEventEmitter = (dbClient) => {
  const eventEmitter = new EventEmitter();

  eventEmitter.poll = async () => {
    const { object } = await dbClient.getShardingInfo({
      instanceName: HOSTNAME,
    });
    if (object != null) {
      const { shardId: newShardId, totalShards: newTotalShards } = object;
      if (newShardId !== shardId || newTotalShards !== totalShards) {
        shardId = newShardId;
        totalShards = newTotalShards;
        eventEmitter.emit("sharding", {
          shardId,
          totalShards,
        });
      }
    }
  };

  return eventEmitter;
};

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
  shardEventEmitter,
  lastPollTime = minutesAgo(1),
  currentPolls = 0,
}) => {
  shardEventEmitter.poll();
  // Restart the client when sharding happens
  shardEventEmitter.on("sharding", async ({ shardId, totalShards }) => {
    console.log(
      `Restarting discord shard due to sharding with args ${JSON.stringify({
        shardId,
        totalShards,
      })}`
    );
    botClient.destroy();
    const newBotClient = await createBotClient({
      dbClient,
      shardId,
      totalShards,
    });
    pollNFTEvents({
      botClient: newBotClient,
      dbClient,
      shardEventEmitter,
      lastPollTime: new Date(),
      currentPolls: currentPolls + 1,
    });
  });
  const { objects: nftEvents } = await dbClient.getWatchedNFTEvents({
    createdAt: lastPollTime,
  });
  const newPollTime = new Date();
  const myEvents = nftEvents.reduce((events, { watchers, ...event }) => {
    const myWatchers = watchers.filter(({ discordId }) => {
      // eslint-disable-next-line no-bitwise
      return (discordId >> 22) % totalShards === shardId;
    });
    if (myWatchers.length > 0) {
      return events.concat({ ...event, watchers: myWatchers });
    }

    return events;
  }, []);
  myEvents.forEach((event) => {
    botClient.emit("nftEvent", event);
  });
  await sleep(DELAY_BETWEEN_POLLS);
  if (currentPolls < POLLS_BETWEEN_RESETS) {
    pollNFTEvents({
      botClient,
      dbClient,
      shardEventEmitter,
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
      shardEventEmitter,
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
  const shardEventEmitter = createShardEventEmitter({
    dbClient,
    shardId,
    totalShards,
  });
  pollNFTEvents({ dbClient, botClient, shardEventEmitter });
};

start();

process.on("unhandledRejection", (error) => {
  console.log(error);
  logMessage(`Unhandled promise rejection`, "error", error);
  process.exit(-1);
});

process.on("uncaughtException", (error) => {
  console.log(error);
  logMessage(`Uncaught exception`, "error", error);
  process.exit(-1);
});
