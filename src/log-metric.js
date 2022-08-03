import path from "path";
import dotenv from "dotenv";
import createStatsDClient from "hot-shots";
import logMessage from "./log-message.js";

dotenv.config({ path: path.resolve(".env") });

const {
  ETHEREUM_NETWORK = "homestead",
  SHARD_ID = 0,
  STATSD_METRIC_PREFIX = "flipance.",
} = process.env;

const errorHandler = (error) => {
  logMessage({ message: "Error logging StatsD metric", level: "error", error });
};

const statsDClient = new createStatsDClient({
  prefix: STATSD_METRIC_PREFIX,
  port: 8125,
  globalTags: {
    network: ETHEREUM_NETWORK,
    "shard-id": SHARD_ID,
    service: "flipance",
  },
  errorHandler,
});

/**
 * Modifies the value of a StatsD metric
 * @param {Object} params
 * @param {String} params.name
 * @param {Number} params.value
 * @param {"increment"|"decrement"} params.action
 */
export default ({ name, value, action, tags = { app: "shard" } }) => {
  switch (action) {
    case "gauge":
      statsDClient.gauge(name, value, 1, tags);
      break;
    case "decrement":
      statsDClient.decrement(name, value || -1, 1, tags);
      break;
    case "increment":
    default:
      statsDClient.increment(name, value || 1, 1, tags);
      break;
  }
};
