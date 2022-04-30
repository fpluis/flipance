import AWS from "aws-sdk";

const dynamodb = new AWS.DynamoDB({ region: "us-east-1" });

export let alerts = {};

export const loadAlerts = async () => {
  const result = await dynamodb
    .scan({
      TableName: "FlipanceAlerts",
    })
    .promise()
    .catch(console.error);
  alerts = result.Items.reduce(
    (
      map,
      {
        address: { S: address },
        userId: { S: userId } = {},
        channelId: { S: channelId } = {},
      }
    ) => {
      const addressCurrent = map[address] || [];
      const alert = { userId };
      if (channelId) {
        alert.channelId = channelId;
      }

      map[address] = addressCurrent.concat(alert);
      return map;
    },
    {}
  );
};

export const getUserAlerts = async (userId) => {
  const result = await dynamodb
    .query({
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": {
          S: userId,
        },
      },
      TableName: "FlipanceAlerts",
    })
    .promise()
    .catch(console.error);
  const { Items = [] } = result;
  return Items.map(
    ({
      address: { S: address },
      network: { S: network },
      userId: { S: userId },
      channelId: { S: channelId } = {},
    }) => {
      const alert = { address, network, userId };
      if (channelId) {
        alert.channelId = channelId;
      }

      return alert;
    }
  );
};

const saveWalletAlert = async ({
  userId,
  address: addressOriginal,
  network,
}) => {
  const address = addressOriginal.toLowerCase();
  const addressAlerts = alerts[address] || [];
  if (addressAlerts.some(({ userId: userId1 }) => userId1 === userId)) {
    return "duplicate";
  }

  addressAlerts.push({ userId, network });
  alerts[address] = addressAlerts;
  await dynamodb
    .putItem({
      Item: {
        address: {
          S: address,
        },
        userId: {
          S: userId,
        },
        network: {
          S: network,
        },
      },
      ReturnConsumedCapacity: "TOTAL",
      TableName: "FlipanceAlerts",
    })
    .promise()
    .catch(console.error);
  return "success";
};

const saveCollectionAlert = async ({
  userId,
  channelId,
  address: addressOriginal,
  network,
}) => {
  const address = addressOriginal.toLowerCase();
  const addressAlerts = alerts[address] || [];
  if (addressAlerts.some(({ userId: userId1 }) => userId1 === userId)) {
    return "duplicate";
  }

  addressAlerts.push({ userId, channelId, network });
  alerts[address] = addressAlerts;
  console.log(`New alerts: ${JSON.stringify(alerts)}`);
  await dynamodb
    .putItem({
      Item: {
        address: {
          S: address,
        },
        userId: {
          S: userId,
        },
        channelId: {
          S: channelId,
        },
        network: {
          S: network,
        },
      },
      ReturnConsumedCapacity: "TOTAL",
      TableName: "FlipanceAlerts",
    })
    .promise()
    .catch(console.error);
  return "success";
};

export const saveAlert = async ({
  userId,
  channelId,
  type,
  address: addressOriginal,
  network = "eth",
}) => {
  const address = addressOriginal.toLowerCase();
  const addressAlerts = alerts[address] || [];
  if (addressAlerts.some(({ userId: userId1 }) => userId1 === userId)) {
    return "duplicate";
  }

  if (type === "wallet") {
    return saveWalletAlert({ userId, address, network });
  }

  return saveCollectionAlert({ userId, channelId, address, network });
};

export const deleteAlert = async ({ userId, address: addressOriginal }) => {
  const address = addressOriginal.toLowerCase();
  const current = alerts[address];
  if (current == null) {
    return "no-alert";
  }

  const withoutUser = current.filter(
    ({ userId: userId1 }) => userId !== userId1
  );
  if (withoutUser.length === current.length) {
    return "no-alert";
  }

  alerts[address] = withoutUser;
  if (alerts[address].length === 0) {
    delete alerts[address];
  }

  await dynamodb
    .deleteItem({
      Key: {
        userId: {
          S: userId,
        },
        address: {
          S: address,
        },
      },
      TableName: "FlipanceAlerts",
    })
    .promise()
    .catch(console.error);
  return "success";
};
