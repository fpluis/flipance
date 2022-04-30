import { readFileSync } from "fs";
import AWS from "aws-sdk";

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const dynamodb = new AWS.DynamoDB({ region: "us-east-1" });

export const users = {};

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const hydrateUserObject = ({
  addresses: { SS: addresses = [] } = {},
  id: { S: id } = {},
  tokens: { SS: tokens = [] } = {},
  syncedAt: { S: syncedAt } = {},
  walletAlertLimit: { N: walletAlertLimit = "1" } = {},
  maxOfferFloorDifference: { N: maxOfferFloorDifference = "15" } = {},
  allowedMarketplaces: { SS: allowedMarketplaces = allMarketplaceIds } = {},
  allowedEvents: { SS: allowedEvents = allEventIds } = {},
}) => ({
  id,
  addresses,
  tokens,
  syncedAt,
  walletAlertLimit: Number(walletAlertLimit),
  maxOfferFloorDifference: Number(maxOfferFloorDifference),
  allowedMarketplaces,
  allowedEvents,
});

const loadUser = async (userId) => {
  console.log(`Loading user ${userId}`);
  const result = await dynamodb
    .getItem({
      Key: {
        id: { S: userId },
      },
      TableName: "FlipanceUsers",
    })
    .promise()
    .catch((error) => {
      console.error(error);
      return { id: { S: userId }, walletAlertLimit: { N: "1" } };
    });
  console.log(`Dynamodb result: ${JSON.stringify(result)}`);
  const { id, ...props } = hydrateUserObject(result.Item);
  users[id] = props;
  return props;
};

export const getUserSettings = async (userId) => {
  const user = await (users[userId] == null
    ? loadUser(userId)
    : Promise.resolve(users[userId]));
  return {
    walletAlertLimit: user.walletAlertLimit,
    maxOfferFloorDifference: user.maxOfferFloorDifference,
    allowedMarketplaces: user.allowedMarketplaces,
    allowedEvents: user.allowedEvents,
  };
};

export const loadUsers = async () => {
  const result = await dynamodb
    .scan({
      TableName: "FlipanceUsers",
    })
    .promise()
    .catch((error) => {
      console.error(error);
      return { Items: [] };
    });
  result.Items.forEach((user) => {
    console.log(`User item: ${JSON.stringify(user)}`);
    const { id, ...props } = hydrateUserObject(user);
    users[id] = props;
  });
};

export const addAddress = async ({ id, addresses, tokens }) => {
  await dynamodb
    .updateItem({
      Key: {
        id: {
          S: id,
        },
      },
      UpdateExpression:
        "ADD #addresses :addresses, #tokens :tokens SET #syncedAt = :syncedAt",
      ExpressionAttributeNames: {
        "#addresses": "addresses",
        "#tokens": "tokens",
        "#syncedAt": "syncedAt",
      },
      ExpressionAttributeValues: {
        ":addresses": {
          SS: addresses,
        },
        ":tokens": {
          SS: tokens,
        },
        ":syncedAt": {
          S: new Date().toISOString(),
        },
      },
      ReturnValues: "ALL_NEW",
      TableName: "FlipanceUsers",
    })
    .promise()
    .then((res) => {
      console.log(`Add address response: ${JSON.stringify(res)}`);
      const { id, ...props } = hydrateUserObject(res.Attributes);
      users[id] = props;
    })
    .catch((error) => {
      console.error(error);
    });
  return "success";
};

const setUserAttributes = async (id, attributes) => {
  const UpdateExpression = `SET ${attributes
    .map(({ name }) => `#${name} = :${name}`)
    .join(", ")}`;
  const ExpressionAttributeNames = attributes.reduce((obj, { name }) => {
    obj[`#${name}`] = name;
    return obj;
  }, {});
  const ExpressionAttributeValues = attributes.reduce(
    (obj, { name, type, value }) => {
      obj[`:${name}`] = {
        [type]: value,
      };
      return obj;
    },
    {}
  );
  await dynamodb
    .updateItem({
      Key: {
        id: {
          S: id,
        },
      },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: "ALL_NEW",
      TableName: "FlipanceUsers",
    })
    .promise()
    .then((res) => {
      console.log(`Update user response: ${JSON.stringify(res)}`);
      const { id, ...props } = hydrateUserObject(res.Attributes);
      users[id] = props;
    })
    .catch((error) => {
      console.error(error);
    });
  return "success";
};

export const updateUserTokens = async ({ id, tokens }) =>
  setUserAttributes(id, [
    {
      name: "tokens",
      value: tokens,
      type: "SS",
    },
    {
      name: "syncedAt",
      value: new Date().toISOString(),
      type: "S",
    },
  ]);

export const updateUserAllowedMarketplaces = async ({
  id,
  allowedMarketplaces,
}) =>
  setUserAttributes(id, [
    {
      name: "allowedMarketplaces",
      value: allowedMarketplaces,
      type: "SS",
    },
  ]);

export const updateUserAllowedEvents = async ({ id, allowedEvents }) =>
  setUserAttributes(id, [
    {
      name: "allowedEvents",
      value: allowedEvents,
      type: "SS",
    },
  ]);

export const updateMaxOfferFloorDifference = async ({
  id,
  maxOfferFloorDifference,
}) =>
  setUserAttributes(id, [
    {
      name: "maxOfferFloorDifference",
      value: `${maxOfferFloorDifference}`,
      type: "N",
    },
  ]);

export const deleteAddress = async ({ id, address, tokens }) => {
  await dynamodb
    .updateItem({
      Key: {
        id: {
          S: id,
        },
      },
      UpdateExpression:
        "DELETE #addresses :addresses, #tokens :tokens SET #syncedAt = :syncedAt",
      ExpressionAttributeNames: {
        "#addresses": "addresses",
        "#tokens": "tokens",
        "#syncedAt": "syncedAt",
      },
      ExpressionAttributeValues: {
        ":addresses": {
          SS: [address],
        },
        ":tokens": {
          SS: tokens,
        },
        ":syncedAt": {
          S: new Date().toISOString(),
        },
      },
      ReturnValues: "ALL_NEW",
      TableName: "FlipanceUsers",
    })
    .promise()
    .then((res) => {
      console.log(`Delete address response: ${JSON.stringify(res)}`);
      const { id, ...props } = hydrateUserObject(res.Attributes);
      users[id] = props;
    })
    .catch((error) => {
      console.error(error);
    });
  return "success";
};
