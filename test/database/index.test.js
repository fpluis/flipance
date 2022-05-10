import {
  isDbCreated,
  createDb,
  setUpDb,
  createDbClient,
  clearDb,
} from "../../src/database/index.js";

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
  await clearDb({ dbName });
  return dbClient.destroy();
};

beforeAll(() => setUpTestDatabase());

afterAll(() => tearDownDatabase());

const discordId1 = "1234";
const alarmLimit1 = 1;
const addresses1 = ["0x1234"];
// The token format is collection/tokenId
const tokens1 = ["0x6789/1"];

const discordId2 = "5678";
const alarmLimit2 = 4;
const addresses2 = ["0x5678"];
const tokens2 = ["0x6789/2", "0x8888/8"];

const collection1 = "0x6789";
const channelId1 = "111111";

beforeEach(() => {
  console.log(`Clearing DB before the next test`);
  return clearDb({ dbName });
});

test("createUser with a duplicate discordId", async () => {
  const firstCreateResult = await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  expect(firstCreateResult).toMatchObject({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const secondCreateResult = await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit2,
    addresses: addresses2,
    tokens: tokens2,
  });
  expect(secondCreateResult).toBe(false);
  const users = await dbClient.getAllUsers();
  expect(users.length).toBe(1);
});

test("getUserByDiscordId with no users", async () => {
  const user = await dbClient.getUserByDiscordId(discordId1);
  expect(user).toBe(null);
});

test("getUserByDiscordId with no matching user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const user = await dbClient.getUserByDiscordId(discordId2);
  expect(user).toBe(null);
});

test("getUserByDiscordId with a matching user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const user = await dbClient.getUserByDiscordId(discordId1);
  expect(user).toMatchObject({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getAllUsers with no users", async () => {
  const users = await dbClient.getAllUsers();
  expect(users).toBe([]);
});

test("getAllUsers after creating one user on the database", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const users = await dbClient.getAllUsers();
  expect(users.length).toBe(1);
  expect(users[0]).toMatchObject({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getAllUsers after creating two users on the database", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.createUser({
    discordId: discordId2,
    alarmLimit: alarmLimit2,
    addresses: addresses2,
    tokens: tokens2,
  });
  const users = await dbClient.getAllUsers();
  expect(users.length).toBe(2);
  expect(users[0].id).not.toBe(users[1].id);
});

test("getUsers with no users", async () => {
  const users = await dbClient.getUsers([]);
  expect(users).toBe([]);
});

test("getUsers with one matching user on the database", async () => {
  const user = await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const users = await dbClient.getUsers([user.id]);
  expect(users.length).toBe(1);
  expect(users[0]).toMatchObject({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getUsers with two matching users on the database", async () => {
  const firstUser = await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const secondUser = await dbClient.createUser({
    discordId: discordId2,
    alarmLimit: alarmLimit2,
    addresses: addresses2,
    tokens: tokens2,
  });
  const users = await dbClient.getUsers([firstUser.id, secondUser.id]);
  expect(users.length).toBe(2);
  expect(users[0].id).not.toBe(users[1].id);
});

test("getUsers with one of two matching users on the database", async () => {
  const firstUser = await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.createUser({
    discordId: discordId2,
    alarmLimit: alarmLimit2,
    addresses: addresses2,
    tokens: tokens2,
  });
  const users = await dbClient.getUsers([firstUser.id, 12371239812]);
  expect(users.length).toBe(1);
  expect(users[0].id).toBe(firstUser.id);
});

test("addUserAddress with a missing user", async () => {
  const newAddresses = ["0x4321"];
  const newTokens = ["0x6789/2"];
  await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toBe(newAddresses);
  expect(updatedUser.tokens).toBe(newTokens);
});

test("addUserAddress with an address and no tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const newAddresses = ["0x4321"];
  const newTokens = ["0x6789/2"];
  await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toBe([...addresses1, ...newAddresses]);
  expect(updatedUser.tokens).toBe([...tokens1, ...newTokens]);
});

test("addUserAddress with duplicate address and tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const newAddresses = [...addresses1, "0x4321"];
  const newTokens = [...tokens1, "0x6789/2"];
  await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toBe([...addresses1, ...newAddresses]);
  expect(updatedUser.tokens).toBe([...tokens1, ...newTokens]);
});

test("deleteUserAddress with a missing user", async () => {
  const wasDeleted = await dbClient.deleteUserAddress({
    discordId: discordId1,
    address: addresses1[0],
    tokens: [],
  });
  expect(wasDeleted).toBe(false);
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser).toBe(null);
});

test("deleteUserAddress with an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const wasDeleted = await dbClient.deleteUserAddress({
    discordId: discordId1,
    address: addresses1[0],
    tokens: tokens1,
  });
  expect(wasDeleted).toBe(true);
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toBe([]);
  expect(updatedUser.tokens).toBe([]);
});

test("deleteUserAddress with an address that the user doesn't have", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const wasDeleted = await dbClient.deleteUserAddress({
    discordId: discordId1,
    address: addresses2[0],
    tokens: tokens1,
  });
  expect(wasDeleted).toBe(true);
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toBe(addresses1);
  expect(updatedUser.tokens).toBe([]);
});

test("deleteUserAddress with an existing user but without the tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const wasDeleted = await dbClient.deleteUserAddress({
    discordId: discordId1,
    address: addresses1[0],
    tokens: [],
  });
  expect(wasDeleted).toBe(true);
  const updatedUser = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toBe([]);
  expect(updatedUser.tokens).toBe(tokens1);
});

test("setUserTokens with a missing user", async () => {
  await dbClient.setUserTokens({
    id: 0,
    tokens: tokens2,
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user).toBe(null);
});

test("setUserTokens on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.setUserTokens({
    id: 0,
    tokens: tokens2,
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user.tokens).toBe(tokens2);
});

test("setMaxFloorDifference with a missing user", async () => {
  await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 10,
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user).toBe(null);
});

test("setMaxFloorDifference on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 10,
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user.maxOfferFloorDifference).toBe(10);
});

test("setMaxFloorDifference on an existing alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    address: addresses1[0],
    maxOfferFloorDifference: 10,
  });
  const [alert] = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alert.maxOfferFloorDifference).toBe(10);
});

// Valid events are located at data/nft-events.json
test("setAllowedEvents with a missing user", async () => {
  await dbClient.setAllowedEvents({
    discordId: discordId1,
    setAllowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user).toBe(null);
});

test("setAllowedEvents on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.setAllowedEvents({
    discordId: discordId1,
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user.allowedEvents).toEqual(
    expect.arrayContaining(["offer", "placeBid", "acceptAsk"])
  );
});

test("setAllowedEvents on an existing alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.setAllowedEvents({
    discordId: discordId1,
    address: addresses1[0],
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  const [alert] = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alert.allowedEvents).toEqual(
    expect.arrayContaining(["offer", "placeBid", "acceptAsk"])
  );
});

// Valid events are located at data/marketplaces.json
test("setAllowedMarketplaces with a missing user", async () => {
  await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user).toBe(null);
});

test("setAllowedMarketplaces on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    alarmLimit: alarmLimit1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  const [user] = await dbClient.getUsers([0]);
  expect(user.allowedMarketplaces).toEqual(
    expect.arrayContaining(["rarible", "openSea", "looksRare"])
  );
});

test("setAllowedMarketplaces on an existing alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    address: addresses1[0],
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  const [alert] = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alert.allowedEvents).toEqual(
    expect.arrayContaining(["rarible", "openSea", "looksRare"])
  );
});

test("setCollectionOffer with a new collection", async () => {
  const now = new Date();
  const tomorrow = now.setDate(now.getDate() + 1);
  await dbClient.setCollectionOffer({
    address: collection1,
    price: 1,
    endTime: tomorrow,
  });
  const offers = await dbClient.getAllOffers();
  expect(offers.length).toBe(1);
  expect(offers[0]).toMatchObject({
    address: collection1,
    price: 1,
    endTime: tomorrow,
  });
});

test("setCollectionOffer overwriting an existing collection", async () => {
  const now = new Date();
  const tomorrow = now.setDate(now.getDate() + 1);
  await dbClient.setCollectionOffer({
    address: collection1,
    price: 1,
    endTime: tomorrow,
  });
  const now2 = new Date();
  const inTwoDates = now2.setDate(now2.getDate() + 2);
  await dbClient.setCollectionOffer({
    address: collection1,
    price: 4,
    endTime: inTwoDates,
  });
  const offers = await dbClient.getAllOffers();
  expect(offers.length).toBe(1);
  expect(offers[0]).toMatchObject({
    address: collection1,
    price: 4,
    endTime: inTwoDates,
  });
});

test("createAlert with a collection alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
  const alertsByAddress = await dbClient.getAlertsByAddress(collection1);
  expect(alertsByAddress.length).toBe(1);
  expect(alertsByAddress[0]).toMatchObject({
    discordId: discordId1,
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
});

test("createAlert with a collection alert with nickname", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    channelId: channelId1,
    type: "collection",
    address: collection1,
    nickname: "CryptoPunks",
  });
  const alertsByAddress = await dbClient.getAlertsByAddress(collection1);
  expect(alertsByAddress.length).toBe(1);
  expect(alertsByAddress[0]).toMatchObject({
    discordId: discordId1,
    channelId: channelId1,
    type: "collection",
    address: collection1,
    nickname: "CryptoPunks",
  });
});

test("createAlert with a wallet alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  const alertsByAddress = await dbClient.getAlertsByAddress(collection1);
  expect(alertsByAddress.length).toBe(1);
  expect(alertsByAddress[0]).toMatchObject({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
});

test("createAlert with a wallet alert including the nickname", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
  const alertsByAddress = await dbClient.getAlertsByAddress(collection1);
  expect(alertsByAddress.length).toBe(1);
  expect(alertsByAddress[0]).toMatchObject({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
});

test("createAlert with two wallet alerts on the same address", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.createAlert({
    discordId: discordId2,
    type: "wallet",
    address: addresses1[0],
  });
  const alertsByAddress = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alertsByAddress.length).toBe(2);
});

test("deleteAlert with a missing alert", async () => {
  const result = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(result).toBe(false);
});

test("deleteAlert with an existing alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  const result = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(result).toBe(true);
});

test("deleteAlert with a user that has two alerts", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses2[0],
  });
  const result = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(result).toBe(true);
  const userAlerts = await dbClient.getUserAlerts(discordId1);
  expect(userAlerts.length).toBe(1);
  expect(userAlerts[0]).toMatchObject({
    discordId: discordId1,
    type: "wallet",
    address: addresses2[0],
  });
});

test("setAlertNickname with an existing alert", async () => {
  await dbClient.createAlert({
    discordId: discordId1,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.setAlertNickname({
    discordId: discordId1,
    address: addresses1[0],
    nickname: "deposit-1",
  });
  const userAlerts = await dbClient.getUserAlerts(discordId1);
  expect(userAlerts.length).toBe(1);
  expect(userAlerts[0]).toMatchObject({
    discordId: discordId1,
    type: "wallet",
    address: addresses2[0],
    nickname: "deposit-1",
  });
});
