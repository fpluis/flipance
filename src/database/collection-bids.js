import AWS from "aws-sdk";

const dynamodb = new AWS.DynamoDB({ region: "us-east-1" });

export const collectionBids = {};

export const loadCollectionBids = async () => {
  const result = await dynamodb
    .scan({
      TableName: "FlipanceBids",
    })
    .promise()
    .catch(console.error);
  result.Items.forEach(
    ({
      address: { S: address },
      price: { S: price } = {},
      endTime: { N: endTime } = {},
    }) => {
      collectionBids[address] = { price, endTime };
    }
  );
};

export const updateCollectionBid = async ({ price, address, endTime }) => {
  collectionBids[address] = { price, endTime };
  const Item = {
    address: {
      S: address,
    },
    price: {
      S: price,
    },
    endTime: {
      N: `${endTime}`,
    },
  };
  await dynamodb
    .putItem({
      Item,
      ReturnConsumedCapacity: "TOTAL",
      TableName: "FlipanceBids",
    })
    .promise()
    .catch(console.error);
  return "success";
};
