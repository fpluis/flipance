import path from "path";
import dotenv from "dotenv";
import { Util } from "discord.js";
import k8s from "@kubernetes/client-node";
import sleep from "../src/sleep.js";
import { createDbClient } from "../src/database/index.js";
import logMessage from "../src/log-message.js";

dotenv.config({ path: path.resolve(".env") });
const { DISCORD_BOT_TOKEN } = process.env;

const deploymentName = "shard";
const namespace = "flipance";
const POLLING_PERIOD = 30 * 1000;
const POLL_DISCORD_SHARDS_PERIOD = 15 * 60 * 1000;

const periodicAutoscale = async (args) => {
  const { k8sCoreApi, dbClient } = args;

  const listNamespacePodResult = await k8sCoreApi
    .listNamespacedPod(namespace)
    .catch(() => {
      return {};
    });
  if (listNamespacePodResult.body == null) {
    await sleep(POLLING_PERIOD);
    return periodicAutoscale(args);
  }

  const {
    body: { items: pods },
  } = listNamespacePodResult;
  const podNames = pods.reduce(
    (
      names,
      {
        metadata: {
          name,
          labels: { group },
        },
      }
    ) => {
      if (group === "shards") {
        return names.concat(name);
      }

      return names;
    },
    []
  );
  await Promise.all(
    podNames.map((instanceName, shardId) =>
      dbClient.setShardingInfo({
        shardId,
        instanceName,
        totalShards: podNames.length,
      })
    )
  ).catch((error) => {
    console.log(`Error updating DB state with new sharding info`, error);
    return [];
  });
  await sleep(POLLING_PERIOD);
  return periodicAutoscale(args);
};

const getDiscordRecommendedShardCount = () => {
  return Util.fetchRecommendedShards(DISCORD_BOT_TOKEN)
    .then((response) => {
      return response;
    })
    .catch(async (response) => {
      console.log(
        `Error getting Discord's recommended shard count: ${JSON.stringify(
          response
        )}`
      );
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        await sleep(Number(retryAfter) * 1000);
      }

      // return Promise.resolve(Math.floor(Math.random() * 3) + 1);
      return null;
    });
};

const pollDiscordShards = async (args) => {
  const { k8sApi } = args;
  const shardCount = await getDiscordRecommendedShardCount();
  if (shardCount == null) {
    await sleep(POLL_DISCORD_SHARDS_PERIOD);
    return pollDiscordShards(args);
  }

  const namespacedDeploymentResponse = await k8sApi
    .readNamespacedDeployment(deploymentName, namespace)
    .catch(async (error) => {
      console.log(`Error reading deployments:`, error);
      return {};
    });
  const { body: deployment } = namespacedDeploymentResponse;
  if (deployment == null) {
    await sleep(POLL_DISCORD_SHARDS_PERIOD);
    return pollDiscordShards(args);
  }

  if (Number(deployment.spec.replicas) !== shardCount) {
    deployment.spec.replicas = shardCount;
    const result = await k8sApi
      .replaceNamespacedDeployment(deploymentName, namespace, deployment)
      .then(() => "success")
      .catch((error) => {
        logMessage(
          `Error editing the namespaced deployment with args ${JSON.stringify(
            deploymentName,
            namespace,
            deployment
          )}:`,
          "error",
          error
        );
        return "error";
      });
    if (result !== "success") {
      return pollDiscordShards(args);
    }
  }

  await sleep(POLL_DISCORD_SHARDS_PERIOD);
  return pollDiscordShards(args);
};

const start = async () => {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
  const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
  const dbClient = await createDbClient();
  const args = { k8sApi, k8sCoreApi, dbClient };
  periodicAutoscale(args);
  pollDiscordShards(args);
};

start();
