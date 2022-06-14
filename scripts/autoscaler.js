import path from "path";
import dotenv from "dotenv";
import { Util } from "discord.js";
import k8s from "@kubernetes/client-node";
import sleep from "../src/sleep.js";
import { createDbClient } from "../src/database/index.js";

dotenv.config({ path: path.resolve(".env") });
const { DISCORD_BOT_TOKEN } = process.env;

const deploymentName = "shard";
const namespace = "flipance";

const periodicAutoscale = async ({ k8sApi, k8sCoreApi, dbClient }) => {
  console.log(`Running the autoscaler`);
  const namespacedDeploymentResponse = await k8sApi
    .readNamespacedDeployment(deploymentName, namespace)
    .catch(async (error) => {
      console.log(`Error reading deployments:`, error);
      await sleep(30 * 1000);
      return {};
    });
  const { body: deployment } = namespacedDeploymentResponse;
  const shardCount = Math.floor(Math.random() * 3) + 1;
  const actualShardCount = await Util.fetchRecommendedShards(DISCORD_BOT_TOKEN);
  console.log(
    `Current replicas: ${
      deployment.spec.replicas
    }. Setting shard count to: ${JSON.stringify(
      actualShardCount
    )} (fake to ${shardCount})`
  );
  if (Number(deployment.spec.replicas) !== shardCount) {
    deployment.spec.replicas = shardCount;
    await k8sApi
      .replaceNamespacedDeployment(deploymentName, namespace, deployment)
      .catch((error) => {
        console.log(
          `Error editing the namespaced deployment with args ${JSON.stringify(
            deploymentName,
            namespace,
            deployment
          )}:`,
          error
        );
      });
  }

  const {
    reponse: {
      body: { items: pods },
    },
  } = await k8sCoreApi.listNamespacedPod(namespace);
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
  console.log(`Pod names: ${JSON.stringify(podNames)}`);
  const results = await Promise.all(
    podNames.map((instanceName, shardId) =>
      dbClient.setShardingInfo({
        shardId,
        instanceName,
        totalShards: podNames.length,
      })
    )
  );
  console.log(`Update sharding info results: ${JSON.stringify(results)}`);
  await sleep(30 * 1000);
  periodicAutoscale({ k8sApi, k8sCoreApi, dbClient });
};

const start = async () => {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
  const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
  const dbClient = await createDbClient();
  periodicAutoscale({ k8sApi, k8sCoreApi, dbClient });
};

start();
