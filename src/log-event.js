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
 * @param {String} params.title
 * @param {String} params.description
 * @param {Object} params.tags
 */
export default ({ title, description = title, tags = { app: "shard" } }) => {
  const validTags = Object.entries(tags).reduce(
    (obj, [tag, value]) => {
      if (["string", "number"].includes(typeof value)) {
        obj[tag] = value;
      }

      return obj;
    },
    { app: "shard" }
  );
  logMessage({
    message: "Log event",
    validTags,
    tags,
  });
  statsDClient.event(
    title,
    description,
    { date_happened: new Date(), alert_type: "info" },
    validTags
  );
};
