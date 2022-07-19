import path from "path";
import dotenv from "dotenv";
import createStatsDClient from "hot-shots";
import logMessage from "./log-message.js";
import logMetric from "./log-metric.js";

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
export default ({
  title,
  description = title,
  tags = { app: "shard" },
  aggregationKey,
}) => {
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
    title,
    tags: validTags,
  });
  statsDClient.event(
    title,
    description,
    {
      date_happened: new Date(),
      alert_type: "info",
      source_type_name: "flipance",
      aggregation_key: aggregationKey,
    },
    validTags
  );
  switch (title) {
    case "new_user":
      logMetric({ name: "total_users", action: "increment" });
      break;
    case "create_wallet_alert":
      logMetric({ name: "total_wallet_alerts", action: "increment" });
      break;
    case "delete_wallet_alert":
      logMetric({ name: "total_wallet_alerts", action: "decrement" });
      break;
    case "alert_sent":
    default:
      logMetric({ name: "total_alerts_sent", action: "increment" });
      break;
  }
};
