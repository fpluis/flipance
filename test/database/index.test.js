import {
  isDbCreated,
  createDb,
  setUpDb,
  createDbClient,
  clearDb,
  removeDb,
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
  await dbClient.destroy();
  await removeDb({ dbName });
  console.log(`DB ${dbName} destroyed`);
};

beforeAll(() => setUpTestDatabase());

afterAll(() => tearDownDatabase(), 10000);

const discordId1 = "1234";
const addresses1 = ["0x1234"];
// The token format is collection/tokenId
const tokens1 = ["0x6789/1"];

const discordId2 = "5678";
const addresses2 = ["0x5678"];
const tokens2 = ["0x6789/2", "0x8888/8"];

const collection1 = "0x6789";
const channelId1 = "111111";

beforeEach(() => {
  return clearDb({ dbName });
});

test("createUser with a duplicate discordId", async () => {
  const { success: firstCreateSuccess, object: firstUser } =
    await dbClient.createUser({
      discordId: discordId1,
      addresses: addresses1,
      tokens: tokens1,
    });
  expect(firstCreateSuccess).toBe(true);
  expect(firstUser).toMatchObject({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: secondCreateSuccess, object: secondUser } =
    await dbClient.createUser({
      discordId: discordId1,
      addresses: addresses2,
      tokens: tokens2,
    });
  expect(secondCreateSuccess).toBe(false);
  expect(secondUser).toBe(null);
});

test("getUserByDiscordId with no users", async () => {
  const { success, object: user } = await dbClient.getUserByDiscordId(
    discordId1
  );
  expect(success).toBe(true);
  expect(user).toBe(null);
});

test("getUserByDiscordId with no matching user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success, object: user } = await dbClient.getUserByDiscordId(
    discordId2
  );
  expect(success).toBe(true);
  expect(user).toBe(null);
});

test("getUserByDiscordId with a matching user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success, object: user } = await dbClient.getUserByDiscordId(
    discordId1
  );
  expect(success).toBe(true);
  expect(user).toMatchObject({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getAllUsers with no users", async () => {
  const { success, objects: users } = await dbClient.getAllUsers();
  expect(success).toBe(true);
  expect(users).toMatchObject([]);
});

test("getAllUsers after creating one user on the database", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success, objects: users } = await dbClient.getAllUsers();
  expect(success).toBe(true);
  expect(users.length).toBe(1);
  expect(users[0]).toMatchObject({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getAllUsers after creating two users on the database", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.createUser({
    discordId: discordId2,
    addresses: addresses2,
    tokens: tokens2,
  });
  const { success, objects: users } = await dbClient.getAllUsers();
  expect(success).toBe(true);
  expect(users.length).toBe(2);
  expect(users[0].id).not.toBe(users[1].id);
});

test("getUsers with no users", async () => {
  const { success, objects: users } = await dbClient.getUsers([]);
  expect(success).toBe(true);
  expect(users).toMatchObject([]);
});

test("getUsers with one matching user on the database", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { objects: users } = await dbClient.getUsers([user.id]);
  console.log(
    `Users found for ids ${JSON.stringify([user.id])}: ${JSON.stringify(users)}`
  );
  expect(users.length).toBe(1);
  expect(users[0]).toMatchObject({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getUsers with two matching users on the database", async () => {
  const { object: firstUser } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { object: secondUser } = await dbClient.createUser({
    discordId: discordId2,
    addresses: addresses2,
    tokens: tokens2,
  });
  const { objects: users } = await dbClient.getUsers([
    firstUser.id,
    secondUser.id,
  ]);
  expect(users.length).toBe(2);
  expect(users[0].id).not.toBe(users[1].id);
});

test("getUsers with one of two matching users on the database", async () => {
  const { object: firstUser } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  await dbClient.createUser({
    discordId: discordId2,
    addresses: addresses2,
    tokens: tokens2,
  });
  const { objects: users } = await dbClient.getUsers([firstUser.id, 1237123]);
  expect(users.length).toBe(1);
  expect(users[0].id).toBe(firstUser.id);
});

test("addUserAddress with a missing user", async () => {
  const newAddresses = ["0x4321"];
  const newTokens = ["0x6789/2"];
  const { success: userWasUpdated } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  expect(userWasUpdated).toBe(false);
  const { success: userWasCreated } = await dbClient.getUserByDiscordId(
    discordId1
  );
  expect(userWasCreated).toBe(true);
});

test("addUserAddress with an address and no tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const newAddresses = ["0x4321"];
  const newTokens = ["0x6789/2"];
  const { success: userWasUpdated } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  expect(userWasUpdated).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toMatchObject([...addresses1, ...newAddresses]);
  expect(updatedUser.tokens).toMatchObject([...tokens1, ...newTokens]);
});

test("addUserAddress with duplicate address and tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const newAddresses = [...addresses1, "0x4321"];
  const newTokens = [...tokens1, "0x6789/2"];
  const { success: userWasUpdated } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  expect(userWasUpdated).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toMatchObject([...addresses1, ...newAddresses]);
  expect(updatedUser.tokens).toMatchObject([...tokens1, ...newTokens]);
});

test("deleteUserAddresses with a missing user", async () => {
  const { success: wasDeleted } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses1,
    tokens: [],
  });
  expect(wasDeleted).toBe(false);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser).toBe(null);
});

test("deleteUserAddresses with an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasDeleted } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  expect(wasDeleted).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toMatchObject([]);
  expect(updatedUser.tokens).toMatchObject([]);
});

test("deleteUserAddresses with an address that the user doesn't have", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasDeleted } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses2,
    tokens: tokens1,
  });
  expect(wasDeleted).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toMatchObject(addresses1);
  expect(updatedUser.tokens).toMatchObject([]);
});

test("deleteUserAddresses with an existing user but without the tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasDeleted } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses1,
    tokens: [],
  });
  expect(wasDeleted).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.addresses).toMatchObject([]);
  expect(updatedUser.tokens).toMatchObject(tokens1);
});

test("setUserTokens with a missing user", async () => {
  const { success: wasUpdated } = await dbClient.setUserTokens({
    id: 0,
    tokens: tokens2,
  });
  expect(wasUpdated).toBe(false);
  const { objects: users } = await dbClient.getUsers([0]);
  expect(users.length).toBe(0);
});

test("setUserTokens on an existing user", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasUpdated } = await dbClient.setUserTokens({
    id: user.id,
    tokens: tokens2,
  });
  expect(wasUpdated).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.tokens).toMatchObject(tokens2);
});

test("setMaxFloorDifference with a missing user", async () => {
  const { success: wasUpdated } = await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 10,
  });
  expect(wasUpdated).toBe(false);
  const { object: user } = await dbClient.getUserByDiscordId(discordId1);
  expect(user).toBe(null);
});

test("setMaxFloorDifference on an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasUpdated } = await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    maxOfferFloorDifference: 10,
  });
  expect(wasUpdated).toBe(true);
  const { object: updatedUser } = await dbClient.getUserByDiscordId(discordId1);
  expect(updatedUser.maxOfferFloorDifference).toBe(10);
});

test("setMaxFloorDifference on an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.setMaxFloorDifference({
    discordId: discordId1,
    address: addresses1[0],
    maxOfferFloorDifference: 10,
  });
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alert.maxOfferFloorDifference).toBe(10);
});

// Valid events are located at data/nft-events.json
test("setAllowedEvents with a missing user", async () => {
  const { success: wasUpdated } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    setAllowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(wasUpdated).toBe(false);
  const { object: user } = await dbClient.getUserByDiscordId(discordId1);
  expect(user).toBe(null);
});

test("setAllowedEvents on an existing user", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasUpdated } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(wasUpdated).toBe(true);
  const {
    objects: [updatedUser],
  } = await dbClient.getUsers([user.id]);
  expect(updatedUser.allowedEvents).toEqual(["offer", "placeBid", "acceptAsk"]);
});

test("setAllowedEvents on an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  const { success: wasUpdated } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    address: addresses1[0],
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(wasUpdated).toBe(true);
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alert.allowedEvents).toEqual(["offer", "placeBid", "acceptAsk"]);
});

// Valid events are located at data/marketplaces.json
test("setAllowedMarketplaces with a missing user", async () => {
  const { success: wasUpdated } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(wasUpdated).toBe(false);
  const { objects: users } = await dbClient.getUsers([0]);
  expect(users).toMatchObject([]);
});

test("setAllowedMarketplaces on an existing user", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { success: wasUpdated } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(wasUpdated).toBe(true);
  const {
    objects: [updatedUser],
  } = await dbClient.getUsers([user.id]);
  expect(updatedUser.allowedMarketplaces).toEqual([
    "rarible",
    "openSea",
    "looksRare",
  ]);
});

test("setAllowedMarketplaces on an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  const { success: wasUpdated } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    address: addresses1[0],
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(wasUpdated).toBe(true);
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress(addresses1[0]);
  expect(alert.allowedMarketplaces).toEqual([
    "rarible",
    "openSea",
    "looksRare",
  ]);
});

test("setCollectionOffer with a new collection", async () => {
  const now = new Date();
  const tomorrow = now.setDate(now.getDate() + 1);
  const { success } = await dbClient.setCollectionOffer({
    address: collection1,
    price: 1,
    endsAt: tomorrow,
  });
  expect(success).toBe(true);
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
  const { success: firstSuccess } = await dbClient.setCollectionOffer({
    address: collection1,
    price: 1,
    endsAt: tomorrow,
  });
  expect(firstSuccess).toBe(true);
  const now2 = new Date();
  const inTwoDates = now2.setDate(now2.getDate() + 2);
  const { success: secondSuccess } = await dbClient.setCollectionOffer({
    address: collection1,
    price: 4,
    endsAt: inTwoDates,
  });
  expect(secondSuccess).toBe(true);
  const { objects: offers } = await dbClient.getAllCollectionOffers();
  expect(offers.length).toBe(1);
  expect(offers[0]).toMatchObject({
    collection: collection1,
    price: 4,
    endsAt: new Date(inTwoDates),
  });
});

test("createAlert without a valid user", async () => {
  const { success, object: alert } = await dbClient.createAlert({
    discordId: discordId1,
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
  expect(success).toBe(false);
  expect(alert).toBe(null);
});

test("createAlert with a collection alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  const { success, object: alert } = await dbClient.createAlert({
    userId: user.id,
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
  expect(success).toBe(true);
  expect(alert).toMatchObject({
    channelId: channelId1,
    type: "collection",
    address: collection1,
  });
});

test("createAlert with a collection alert with nickname and verify it is correct with getAlertsByAddress", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    channelId: channelId1,
    type: "collection",
    address: collection1,
    nickname: "CryptoPunks",
  });
  const { objects: alertsByAddress } = await dbClient.getAlertsByAddress(
    collection1
  );
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
    addresses: [],
    tokens: [],
  });
  const { object: alert } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  expect(alert).toMatchObject({
    type: "wallet",
    address: addresses1[0],
  });
});

test("createAlert with a wallet alert including the nickname", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  const { object: alert } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
  expect(alert).toMatchObject({
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
});

test("getAlertsByAddress with two wallet alerts from different users on the same address", async () => {
  const { object: user1 } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  const { object: user2 } = await dbClient.createUser({
    discordId: discordId2,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user1.id,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.createAlert({
    userId: user2.id,
    type: "wallet",
    address: addresses1[0],
  });
  const { objects: alertsByAddress } = await dbClient.getAlertsByAddress(
    addresses1[0]
  );
  expect(alertsByAddress.length).toBe(2);
});

test("deleteAlert with a missing alert", async () => {
  const { success } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(success).toBe(false);
});

test("deleteAlert with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  const { success } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(success).toBe(true);
});

test("deleteAlert by nickname with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
  const { success } = await dbClient.deleteAlert({
    discordId: discordId1,
    nickname: "deposit-1",
  });
  expect(success).toBe(true);
});

test("deleteAlert with a user that has two alerts", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses2[0],
  });
  const { objects: userAlerts1 } = await dbClient.getUserAlerts({
    discordId: discordId1,
  });
  console.log(`User alerts 1 ${JSON.stringify(userAlerts1)}`);
  const { success } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(success).toBe(true);
  const { objects: userAlerts } = await dbClient.getUserAlerts({
    discordId: discordId1,
  });
  expect(userAlerts.length).toBe(1);
  expect(userAlerts[0]).toMatchObject({
    type: "wallet",
    address: addresses2[0],
  });
});

test("setAlertNickname with an existing alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  const { success, object: alert } = await dbClient.setAlertNickname({
    discordId: discordId1,
    address: addresses1[0],
    nickname: "deposit-1",
  });
  expect(success).toBe(true);
  expect(alert).toMatchObject({
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
});
