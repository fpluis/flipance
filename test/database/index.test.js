import path from "path";
import { readFileSync } from "fs";
import dotenv from "dotenv";
import {
  isDbCreated,
  createDb,
  setUpDb,
  createDbClient,
  clearDb,
  removeDb,
} from "../../src/database/index.js";

dotenv.config({ path: path.resolve(".env") });

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const { MAX_NICKNAME_LENGTH = 50, MAX_OFFER_FLOOR_DIFFERENCE = 15 } =
  process.env;

const dbName = `flipance-test-${new Date().toISOString().slice(0, 19)}`;

let dbClient;

const setUpTestDatabase = async () => {
  try {
    const exists = await isDbCreated({ dbName });
    expect(exists).toBe(false);
    const createdNewDb = await createDb({ dbName });
    expect(createdNewDb).toBe(true);
    console.log(`Test db "${dbName}" created`);
    await setUpDb({ dbName });
    dbClient = await createDbClient({ dbName });
  } catch (error) {
    if (dbClient) {
      dbClient.destroy();
    }

    console.log(`Error setting up the tests DB:`, error);
    process.exit(-1);
  }
};

const tearDownDatabase = async () => {
  await dbClient.destroy();
  await removeDb({ dbName });
  console.log(`DB ${dbName} destroyed`);
};

beforeAll(() => setUpTestDatabase());

afterAll(() => tearDownDatabase(), 10000);

const discordId1 = "1234";
const address1 = "0x1234";

// The token format is collection/tokenId
const tokens1 = ["0x6789/2", "0x8888/8"];

const collection1 = "0x6789";
const channelId1 = "111111";

const discordId2 = "5678";
const address2 = "0x5678";

beforeEach(() => {
  return clearDb({ dbName });
});

test("createUser without arguments", async () => {
  const { result, object } = await dbClient.createUser();
  expect(result).toBe("missing-arguments");
  expect(object).toBe(null);
});

test("createUser with only the discordId", async () => {
  const { result, object } = await dbClient.createUser({
    discordId: discordId1,
  });
  expect(result).toBe("success");
  expect(object).toMatchObject({
    discordId: discordId1,
  });
});

test("createUser with a duplicate discordId", async () => {
  const { result: firstCreateResult, object: firstUser } =
    await dbClient.createUser({
      discordId: discordId1,
    });
  expect(firstCreateResult).toBe("success");
  expect(firstUser).toMatchObject({
    discordId: discordId1,
  });
  const { result: secondCreateResult, object: secondUser } =
    await dbClient.createUser({
      discordId: discordId1,
    });
  expect(secondCreateResult).toBe("already-exists");
  expect(secondUser).toBe(null);
});

test("getUserByDiscordId with a null discordId", async () => {
  const { result, object: user } = await dbClient.getUserByDiscordId();
  expect(result).toBe("missing-arguments");
  expect(user).toBe(null);
});

test("getUserByDiscordId with no users", async () => {
  const { result, object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(result).toBe("missing-user");
  expect(user).toBe(null);
});

test("getUserByDiscordId with no matching user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
  });
  const { result, object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId2,
  });
  expect(result).toBe("missing-user");
  expect(user).toBe(null);
});

test("getUserByDiscordId with a matching user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
  });
  const { result, object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(result).toBe("success");
  expect(user).toMatchObject({
    discordId: discordId1,
  });
});

test("getAllAlerts with no alerts", async () => {
  const { result, objects: alerts } = await dbClient.getAllAlerts();
  expect(result).toBe("success");
  expect(alerts).toMatchObject([]);
});

test("getAllAlerts after creating one alert on the database", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { result, objects: alerts } = await dbClient.getAllAlerts();
  expect(result).toBe("success");
  expect(alerts.length).toBe(1);
  expect(alerts[0]).toMatchObject({
    userId: user.id,
    address: address1,
  });
});

test("getAllAlerts after creating two alerts", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "collection",
    address: address2,
  });
  const { result, objects: alerts } = await dbClient.getAllAlerts();
  console.log(`Alerts: ${JSON.stringify(alerts)}`);
  expect(result).toBe("success");
  expect(alerts.length).toBe(2);
  expect(alerts[0].id).not.toBe(alerts[1].id);
});

test("setAlertTokens without arguments", async () => {
  const { result, object } = await dbClient.setAlertTokens();
  expect(result).toBe("missing-arguments");
  expect(object).toBe(null);
});

test("setAlertTokens with a missing alert", async () => {
  const { result } = await dbClient.setAlertTokens({
    id: 0,
    tokens: tokens1,
  });
  expect(result).toBe("missing-alert");
});

test("setAlertTokens on an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  const { object: alert } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  expect(alert.tokens).toMatchObject([]);
  const { result } = await dbClient.setAlertTokens({
    id: alert.id,
    tokens: tokens1,
  });
  expect(result).toBe("success");
  const { objects: alerts } = await dbClient.getAlertsByAddress({
    address: address1,
  });
  expect(alerts[0].tokens).toMatchObject(tokens1);
});

test("setMaxFloorDifference without arguments", async () => {
  const { result, object } = await dbClient.setMaxFloorDifference();
  expect(result).toBe("missing-arguments");
  expect(object).toBe(null);
});

test("setMaxFloorDifference with a missing user", async () => {
  const { result } = await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 10,
  });
  expect(result).toBe("missing-user");
  const { object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(user).toBe(null);
});

test("setMaxFloorDifference on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
  });
  const { result } = await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 10,
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.maxOfferFloorDifference).toBe(10);
});

test("setMaxFloorDifference on an existing alert by address", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { object } = await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    address: address1,
    maxOfferFloorDifference: 10,
  });
  console.log(`New settings: ${JSON.stringify(object)}`);
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: address1 });
  console.log(
    `Alert after setting max floor diff to 10: ${JSON.stringify(alert)}`
  );
  expect(alert.maxOfferFloorDifference).toBe(10);
});

test("setMaxFloorDifference on an existing alert using the nickname", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "test",
  });
  await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    nickname: "test",
    maxOfferFloorDifference: 40,
  });
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: address1 });
  expect(alert.maxOfferFloorDifference).toBe(40);
});

test("setAllowedEvents without arguments", async () => {
  const { result, object } = await dbClient.setAllowedEvents();
  expect(result).toBe("missing-arguments");
  expect(object).toBe(null);
});

// Valid events are located at data/nft-events.json
test("setAllowedEvents with a missing user", async () => {
  const { result } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(result).toBe("missing-user");
  const { object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(user).toBe(null);
});

test("setAllowedEvents on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
  });
  const { result } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.allowedEvents).toEqual(["offer", "placeBid", "acceptAsk"]);
});

test("setAllowedEvents on an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { result } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    address: address1,
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(result).toBe("success");
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: address1 });
  expect(alert.allowedEvents).toEqual(["offer", "placeBid", "acceptAsk"]);
});

test("setAllowedEvents on an existing alert using the nickname", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "test",
  });
  const { result } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    nickname: "test",
    allowedEvents: ["offer"],
  });
  expect(result).toBe("success");
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: address1 });
  expect(alert.allowedEvents).toEqual(["offer"]);
});

test("setAllowedMarketplaces without arguments", async () => {
  const { result, object } = await dbClient.setAllowedMarketplaces();
  expect(result).toBe("missing-arguments");
  expect(object).toBe(null);
});

// Valid marketplaces are located at data/marketplaces.json
test("setAllowedMarketplaces with a missing user", async () => {
  const { result } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(result).toBe("missing-user");
  const { object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(user).toBe(null);
});

test("setAllowedMarketplaces on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
  });
  const { result } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.allowedMarketplaces).toEqual([
    "rarible",
    "openSea",
    "looksRare",
  ]);
});

test("setAllowedMarketplaces on an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { result } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    address: address1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(result).toBe("success");
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: address1 });
  expect(alert.allowedMarketplaces).toEqual([
    "rarible",
    "openSea",
    "looksRare",
  ]);
});

test("setAllowedMarketplaces on an existing alert using the nickname", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "test",
  });
  const { result } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    nickname: "test",
    allowedMarketplaces: ["openSea"],
  });
  expect(result).toBe("success");
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: address1 });
  expect(alert.allowedMarketplaces).toEqual(["openSea"]);
});

test("setCollectionOffer without arguments", async () => {
  const { result, object: offer } = await dbClient.setCollectionOffer();
  expect(result).toBe("missing-arguments");
  expect(offer).toBe(null);
});

test("setCollectionOffer with a new collection", async () => {
  const now = new Date();
  const tomorrow = now.setDate(now.getDate() + 1);
  const { result } = await dbClient.setCollectionOffer({
    address: collection1,
    price: 1,
    endsAt: tomorrow,
  });
  expect(result).toBe("success");
  const { objects: offers } = await dbClient.getAllCollectionOffers();
  expect(offers.length).toBe(1);
  expect(offers[0]).toMatchObject({
    collection: collection1,
    price: 1,
    endsAt: new Date(tomorrow),
  });
});

test("setCollectionOffer overwriting an existing collection", async () => {
  const now = new Date();
  const tomorrow = now.setDate(now.getDate() + 1);
  const { result: firstResult } = await dbClient.setCollectionOffer({
    address: collection1,
    price: 1,
    endsAt: tomorrow,
  });
  expect(firstResult).toBe("success");
  const now2 = new Date();
  const inTwoDates = now2.setDate(now2.getDate() + 2);
  const { result: secondResult } = await dbClient.setCollectionOffer({
    address: collection1,
    price: 4,
    endsAt: inTwoDates,
  });
  expect(secondResult).toBe("success");
  const { objects: offers } = await dbClient.getAllCollectionOffers();
  expect(offers.length).toBe(1);
  expect(offers[0]).toMatchObject({
    collection: collection1,
    price: 4,
    endsAt: new Date(inTwoDates),
  });
});

test("createAlert without providing a user id", async () => {
  const { result, object: alert } = await dbClient.createAlert({
    type: "collection",
    address: collection1,
  });
  expect(result).toBe("missing-arguments");
  expect(alert).toBe(null);
});

test("createAlert with a missing user", async () => {
  const { result, object: alert } = await dbClient.createAlert({
    discordId: discordId1,
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
  expect(result).toBe("missing-user");
  expect(alert).toBe(null);
});

test("createAlert with a collection alert", async () => {
  const { result: createUserResult, object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  expect(createUserResult).toBe("success");
  const { result, object: alert } = await dbClient.createAlert({
    userId: user.id,
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
  expect(result).toBe("success");
  expect(alert).toMatchObject({
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
});

test("createAlert with a collection alert with nickname and verify it is correct with getAlertsByAddress", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    channelId: channelId1,
    type: "collection",
    address: collection1,
    nickname: "CryptoPunks",
  });
  const { objects: alertsByAddress } = await dbClient.getAlertsByAddress({
    address: collection1,
  });
  expect(alertsByAddress.length).toBe(1);
  expect(alertsByAddress[0]).toMatchObject({
    channelId: channelId1,
    type: "collection",
    address: collection1,
    nickname: "CryptoPunks",
  });
});

test("createAlert with a wallet alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  const { object: alert } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  expect(alert).toMatchObject({
    type: "wallet",
    address: address1,
  });
});

test("createAlert with a wallet alert including the nickname", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  const { object: alert } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "deposit-1",
  });
  expect(alert).toMatchObject({
    type: "wallet",
    address: address1,
    nickname: "deposit-1",
  });
});

test("createAlert with a wallet alert using a nickname that is too long", async () => {
  const longNickname = new Array(Number(MAX_NICKNAME_LENGTH) + 2).join("a");
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  const { result, object: alert } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: longNickname,
  });
  expect(result).toBe("nickname-too-long");
  expect(alert).toBe(null);
});

test("createAlert with a duplicate wallet alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  const { result: result1, object: alert1 } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  expect(result1).toBe("success");
  expect(alert1).toMatchObject({
    type: "wallet",
    address: address1,
  });
  const { result: result2, object: alert2 } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  expect(result2).toBe("already-exists");
  expect(alert2).toBe(null);
});

test("getAlertsByAddress without arguments", async () => {
  const { result, objects: alerts } = await dbClient.getAlertsByAddress();
  expect(result).toBe("missing-arguments");
  expect(alerts.length).toBe(0);
});

test("getAlertsByAddress without matching alerts", async () => {
  const { result, objects: alerts } = await dbClient.getAlertsByAddress({
    address: address1,
  });
  expect(result).toBe("success");
  expect(alerts.length).toBe(0);
});

test("getAlertsByAddress with two wallet alerts from different users on the same address", async () => {
  const { object: user1 } = await dbClient.createUser({
    discordId: discordId1,
  });
  const { object: user2 } = await dbClient.createUser({
    discordId: discordId2,
  });
  await dbClient.createAlert({
    userId: user1.id,
    type: "wallet",
    address: address1,
  });
  await dbClient.createAlert({
    userId: user2.id,
    type: "wallet",
    address: address1,
  });
  const { objects: alertsByAddress } = await dbClient.getAlertsByAddress({
    address: address1,
  });
  expect(alertsByAddress.length).toBe(2);
});

test("getAlertsByAddress with a setting present in the alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "test",
  });
  await dbClient.setAllowedEvents({
    discordId: discordId1,
    nickname: "test",
    allowedEvents: ["offer"],
  });
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({
    address: address1,
  });
  expect(alert.maxOfferFloorDifference).toBe(MAX_OFFER_FLOOR_DIFFERENCE);
  expect(alert.allowedMarketplaces).toMatchObject(allMarketplaceIds);
  expect(alert.allowedEvents).toMatchObject(["offer"]);
});

test("getAlertsByAddress with a setting present in the user but missing on the alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 32,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({
    address: address1,
  });
  expect(alert.maxOfferFloorDifference).toBe(32);
  expect(alert.allowedMarketplaces).toMatchObject(allMarketplaceIds);
  expect(alert.allowedEvents).toMatchObject(allEventIds);
});

test("getAlertsByNickname without arguments", async () => {
  const { result, objects: alerts } = await dbClient.getAlertsByNickname();
  expect(result).toBe("missing-arguments");
  expect(alerts.length).toBe(0);
});

test("getAlertsByNickname without matching alerts", async () => {
  const { result, objects: alerts } = await dbClient.getAlertsByNickname({
    discordId: discordId1,
    nickname: "test",
  });
  expect(result).toBe("success");
  expect(alerts.length).toBe(0);
});

test("getAlertsByNickname with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "test",
  });
  const { objects: alertsByAddress } = await dbClient.getAlertsByNickname({
    discordId: discordId1,
    nickname: "test",
  });
  expect(alertsByAddress[0]).toMatchObject({
    type: "wallet",
    address: address1,
    nickname: "test",
  });
});

test("deleteAlert with a missing alert", async () => {
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: address1,
  });
  expect(result).toBe("missing-alert");
});

test("deleteAlert with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: address1,
  });
  expect(result).toBe("success");
});

test("deleteAlert by nickname with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
    nickname: "deposit-1",
  });
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    nickname: "deposit-1",
  });
  expect(result).toBe("success");
});

test("getUserAlerts with no arguments", async () => {
  const { result, objects: alerts } = await dbClient.getUserAlerts();
  expect(result).toBe("missing-arguments");
  expect(alerts.length).toBe(0);
});

test("deleteAlert with a user that has two alerts", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address2,
  });
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: address1,
  });
  expect(result).toBe("success");
  const { objects: userAlerts } = await dbClient.getUserAlerts({
    discordId: discordId1,
  });
  expect(userAlerts.length).toBe(1);
  expect(userAlerts[0]).toMatchObject({
    type: "wallet",
    address: address2,
  });
});

test("setAlertNickname with no arguments", async () => {
  const { result, object: alert } = await dbClient.setAlertNickname();
  expect(result).toBe("missing-arguments");
  expect(alert).toBe(null);
});

test("setAlertNickname without one argument", async () => {
  const { result, object: alert } = await dbClient.setAlertNickname({
    address: address1,
    nickname: "deposit-1",
  });
  expect(result).toBe("missing-arguments");
  expect(alert).toBe(null);
});

test("setAlertNickname without a matching alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { result, object: alert } = await dbClient.setAlertNickname({
    discordId: discordId1,
    address: address2,
    nickname: "deposit-1",
  });
  expect(result).toBe("error");
  expect(alert).toBe(null);
});

test("setAlertNickname with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: address1,
  });
  const { result, object: alert } = await dbClient.setAlertNickname({
    discordId: discordId1,
    address: address1,
    nickname: "deposit-1",
  });
  expect(result).toBe("success");
  expect(alert).toMatchObject({
    type: "wallet",
    address: address1,
    nickname: "deposit-1",
  });
});

test("setCollectionFloor with no arguments", async () => {
  const { result, object: collectionFloor } =
    await dbClient.setCollectionFloor();
  expect(result).toBe("missing-arguments");
  expect(collectionFloor).toBe(null);
});

test("setCollectionFloor with one argument", async () => {
  const { result, object: collectionFloor } = await dbClient.setCollectionFloor(
    { collection: collection1 }
  );
  expect(result).toBe("missing-arguments");
  expect(collectionFloor).toBe(null);
});

test("setCollectionFloor with both arguments", async () => {
  const { result, object: collectionFloor } = await dbClient.setCollectionFloor(
    { collection: collection1, price: 0.5 }
  );
  expect(result).toBe("success");
  expect(collectionFloor).toMatchObject({
    collection: collection1,
    price: 0.5,
  });
});

test("getCollectionFloor with no arguments", async () => {
  const { result, object: collectionFloor } =
    await dbClient.getCollectionFloor();
  expect(result).toBe("missing-arguments");
  expect(collectionFloor).toBe(null);
});

test("getCollectionFloor without a matching collection floor", async () => {
  const { result, object: collectionFloor } = await dbClient.getCollectionFloor(
    {
      collection: collection1,
    }
  );
  expect(result).toBe("success");
  expect(collectionFloor).toBe(null);
});

test("getCollectionFloor with a matching collection floor", async () => {
  await dbClient.setCollectionFloor({ collection: collection1, price: 0.5 });
  const { result, object: collectionFloor } = await dbClient.getCollectionFloor(
    {
      collection: collection1,
    }
  );
  expect(result).toBe("success");
  expect(collectionFloor).toMatchObject({
    collection: collection1,
    price: 0.5,
  });
});

test("getCollectionFloor with two collection floors for the same collection", async () => {
  await dbClient.setCollectionFloor({ collection: collection1, price: 0.5 });
  await dbClient.setCollectionFloor({ collection: collection1, price: 4.2 });
  const { result, object: collectionFloor } = await dbClient.getCollectionFloor(
    {
      collection: collection1,
    }
  );
  expect(result).toBe("success");
  expect(collectionFloor).toMatchObject({
    collection: collection1,
    price: 4.2,
  });
});
