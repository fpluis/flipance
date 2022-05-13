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
    addresses: [],
    tokens: [],
  });
});

test("createUser with a duplicate discordId", async () => {
  const { result: firstCreateResult, object: firstUser } =
    await dbClient.createUser({
      discordId: discordId1,
      addresses: addresses1,
      tokens: tokens1,
    });
  expect(firstCreateResult).toBe("success");
  expect(firstUser).toMatchObject({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result: secondCreateResult, object: secondUser } =
    await dbClient.createUser({
      discordId: discordId1,
      addresses: addresses2,
      tokens: tokens2,
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
    addresses: addresses1,
    tokens: tokens1,
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
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result, object: user } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(result).toBe("success");
  expect(user).toMatchObject({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
});

test("getAllUsers with no users", async () => {
  const { result, objects: users } = await dbClient.getAllUsers();
  expect(result).toBe("success");
  expect(users).toMatchObject([]);
});

test("getAllUsers after creating one user on the database", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result, objects: users } = await dbClient.getAllUsers();
  expect(result).toBe("success");
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
  const { result, objects: users } = await dbClient.getAllUsers();
  expect(result).toBe("success");
  expect(users.length).toBe(2);
  expect(users[0].id).not.toBe(users[1].id);
});

test("getUsers with no arguments", async () => {
  const { result, objects: users } = await dbClient.getUsers();
  expect(result).toBe("missing-arguments");
  expect(users).toMatchObject([]);
});

test("getUsers with an empty array", async () => {
  const { result, objects: users } = await dbClient.getUsers({ ids: [] });
  expect(result).toBe("success");
  expect(users).toMatchObject([]);
});

test("getUsers with one matching user on the database", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { objects: users } = await dbClient.getUsers({ ids: [user.id] });
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
  const { objects: users } = await dbClient.getUsers({
    ids: [firstUser.id, secondUser.id],
  });
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
  const { objects: users } = await dbClient.getUsers({
    ids: [firstUser.id, 1237123],
  });
  expect(users.length).toBe(1);
  expect(users[0].id).toBe(firstUser.id);
});

test("addUserAddress without arguments", async () => {
  const { result, object: user } = await dbClient.addUserAddress();
  expect(result).toBe("missing-arguments");
  expect(user).toBe(null);
});

test("addUserAddress with a missing user", async () => {
  const newAddresses = ["0x4321"];
  const newTokens = ["0x6789/2"];
  const { result: userUpdateResult } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  expect(userUpdateResult).toBe("missing-user");
  const { result: getUserResult } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(getUserResult).toBe("missing-user");
});

test("addUserAddress with an address and no tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const newAddresses = ["0x4321"];
  const { result: userWasUpdated } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
  });
  expect(userWasUpdated).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.addresses).toMatchObject([...addresses1, ...newAddresses]);
  expect(updatedUser.tokens).toMatchObject(tokens1);
});

test("addUserAddress with an address and tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const newAddresses = ["0x4321"];
  const newTokens = ["0x6789/2"];
  const { result: userWasUpdated } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  expect(userWasUpdated).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
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
  const { result: userWasUpdated } = await dbClient.addUserAddress({
    discordId: discordId1,
    addresses: newAddresses,
    tokens: newTokens,
  });
  expect(userWasUpdated).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.addresses).toMatchObject([...addresses1, ...newAddresses]);
  expect(updatedUser.tokens).toMatchObject([...tokens1, ...newTokens]);
});

test("deleteUserAddresses with a missing user", async () => {
  const { result } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses1,
    tokens: [],
  });
  expect(result).toBe("missing-user");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser).toBe(null);
});

test("deleteUserAddresses without arguments", async () => {
  const { result, object: updatedUser } = await dbClient.deleteUserAddresses();
  expect(result).toBe("missing-arguments");
  expect(updatedUser).toBe(null);
});

test("deleteUserAddresses with an existing user", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.addresses).toMatchObject([]);
  expect(updatedUser.tokens).toMatchObject([]);
});

test("deleteUserAddresses with an address that the user doesn't have", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses2,
    tokens: tokens1,
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.addresses).toMatchObject(addresses1);
  expect(updatedUser.tokens).toMatchObject([]);
});

test("deleteUserAddresses with an existing user but without the tokens", async () => {
  await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result } = await dbClient.deleteUserAddresses({
    discordId: discordId1,
    addresses: addresses1,
    tokens: [],
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.addresses).toMatchObject([]);
  expect(updatedUser.tokens).toMatchObject(tokens1);
});

test("setUserTokens without arguments", async () => {
  const { result, object } = await dbClient.setUserTokens();
  expect(result).toBe("missing-arguments");
  expect(object).toBe(null);
});

test("setUserTokens with a missing user", async () => {
  const { result } = await dbClient.setUserTokens({
    id: 0,
    tokens: tokens2,
  });
  expect(result).toBe("missing-user");
  const { objects: users } = await dbClient.getUsers({ ids: [0] });
  expect(users.length).toBe(0);
});

test("setUserTokens on an existing user", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result } = await dbClient.setUserTokens({
    id: user.id,
    tokens: tokens2,
  });
  expect(result).toBe("success");
  const { object: updatedUser } = await dbClient.getUserByDiscordId({
    discordId: discordId1,
  });
  expect(updatedUser.tokens).toMatchObject(tokens2);
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
    addresses: addresses1,
    tokens: tokens1,
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
  } = await dbClient.getAlertsByAddress({ address: addresses1[0] });
  expect(alert.maxOfferFloorDifference).toBe(10);
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
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(result).toBe("success");
  const {
    objects: [updatedUser],
  } = await dbClient.getUsers({ ids: [user.id] });
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
  const { result } = await dbClient.setAllowedEvents({
    discordId: discordId1,
    address: addresses1[0],
    allowedEvents: ["offer", "placeBid", "acceptAsk"],
  });
  expect(result).toBe("success");
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: addresses1[0] });
  expect(alert.allowedEvents).toEqual(["offer", "placeBid", "acceptAsk"]);
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
  const { objects: users } = await dbClient.getUsers({ ids: [0] });
  expect(users).toMatchObject([]);
});

test("setAllowedMarketplaces on an existing user", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: addresses1,
    tokens: tokens1,
  });
  const { result } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(result).toBe("success");
  const {
    objects: [updatedUser],
  } = await dbClient.getUsers({ ids: [user.id] });
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
  const { result } = await dbClient.setAllowedMarketplaces({
    discordId: discordId1,
    address: addresses1[0],
    allowedMarketplaces: ["rarible", "openSea", "looksRare"],
  });
  expect(result).toBe("success");
  const {
    objects: [alert],
  } = await dbClient.getAlertsByAddress({ address: addresses1[0] });
  expect(alert.allowedMarketplaces).toEqual([
    "rarible",
    "openSea",
    "looksRare",
  ]);
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
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
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

test("createAlert with a duplicate wallet alert", async () => {
  const { object: user } = await dbClient.createUser({
    discordId: discordId1,
    addresses: [],
    tokens: [],
  });
  const { result: result1, object: alert1 } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
  });
  expect(result1).toBe("success");
  expect(alert1).toMatchObject({
    type: "wallet",
    address: addresses1[0],
  });
  const { result: result2, object: alert2 } = await dbClient.createAlert({
    userId: user.id,
    type: "wallet",
    address: addresses1[0],
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
    address: addresses1[0],
  });
  expect(result).toBe("success");
  expect(alerts.length).toBe(0);
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
  const { objects: alertsByAddress } = await dbClient.getAlertsByAddress({
    address: addresses1[0],
  });
  expect(alertsByAddress.length).toBe(2);
});

test("deleteAlert with a missing alert", async () => {
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(result).toBe("missing-alert");
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
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(result).toBe("success");
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
  const { result } = await dbClient.deleteAlert({
    discordId: discordId1,
    address: addresses1[0],
  });
  expect(result).toBe("success");
  const { objects: userAlerts } = await dbClient.getUserAlerts({
    discordId: discordId1,
  });
  expect(userAlerts.length).toBe(1);
  expect(userAlerts[0]).toMatchObject({
    type: "wallet",
    address: addresses2[0],
  });
});

test("setAlertNickname with no arguments", async () => {
  const { result, object: alert } = await dbClient.setAlertNickname();
  expect(result).toBe("missing-arguments");
  expect(alert).toBe(null);
});

test("setAlertNickname without one argument", async () => {
  const { result, object: alert } = await dbClient.setAlertNickname({
    address: addresses1[0],
    nickname: "deposit-1",
  });
  expect(result).toBe("missing-arguments");
  expect(alert).toBe(null);
});

test("setAlertNickname without a matching alert", async () => {
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
  const { result, object: alert } = await dbClient.setAlertNickname({
    discordId: discordId1,
    address: addresses2[0],
    nickname: "deposit-1",
  });
  expect(result).toBe("error");
  expect(alert).toBe(null);
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
  const { result, object: alert } = await dbClient.setAlertNickname({
    discordId: discordId1,
    address: addresses1[0],
    nickname: "deposit-1",
  });
  expect(result).toBe("success");
  expect(alert).toMatchObject({
    type: "wallet",
    address: addresses1[0],
    nickname: "deposit-1",
  });
});
