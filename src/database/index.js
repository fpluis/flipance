/* eslint-disable no-multi-str */
import process from "process";
import path from "path";
import dotenv from "dotenv";
import postgre from "pg";

const { Pool } = postgre;

dotenv.config({ path: path.resolve(".env") });

const {
  DB_HOSTNAME,
  DB_PORT,
  DB_USERNAME,
  DB_NAME,
  DB_PASSWORD,
  DEFAULT_USER_ALARM_LIMIT = 1,
} = process.env;
// const isTestMode = process.argv.includes("--test");

// console.log(`Is test mode? ${isTestMode}`);

export const isDbCreated = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
  dbName = DB_NAME,
}) => {
  const pool = new Pool({
    host,
    port,
    user,
    password,
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });

  const dbExistsResult = await client.query(
    `SELECT datname FROM pg_catalog.pg_database WHERE datname='${dbName}'`
  );
  console.log(`Db exists result: ${JSON.stringify(dbExistsResult)}`);
  await client.release();
  await pool.end();
  return dbExistsResult.rows.length === 0
    ? false
    : dbExistsResult.rows[0].datname === dbName;
};

export const createDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
  dbName = DB_NAME,
}) => {
  const dbExists = await isDbCreated({ host, port, user, password, dbName });
  if (dbExists) {
    return false;
  }

  const pool = new Pool({
    host,
    port,
    user,
    password,
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });

  console.log(`Created DB "${dbName}"`);
  await client.query(`CREATE DATABASE "${dbName}" WITH ENCODING 'UTF8'`);
  await client.release();
  return pool.end().then(() => true);
};

const createTableQueries = [
  `CREATE TABLE IF NOT EXISTS settings (\
    id serial PRIMARY KEY,\
    max_offer_floor_difference SMALLINT,\
    allowed_marketplaces TEXT [],\
    allowed_events TEXT []\
  );`,
  `CREATE TABLE IF NOT EXISTS users (\
    id serial PRIMARY KEY,\
    settings_id INT NOT NULL,\
    discord_id VARCHAR(20) NOT NULL,\
    created_at TIMESTAMP NOT NULL,\
    alarm_limit SMALLINT NOT NULL,\
    addresses TEXT [],\
    tokens TEXT [],\
    FOREIGN KEY (settings_id)\
        REFERENCES settings (id)\
  );`,
  `CREATE TABLE IF NOT EXISTS alerts (\
    id serial PRIMARY KEY,\
    settings_id INT NOT NULL,\
    user_id INT NOT NULL,\
    nickname VARCHAR(50) NOT NULL,\
    UNIQUE (user_id, nickname),\
    wallet VARCHAR(100) NOT NULL,\
    created_at TIMESTAMP NOT NULL,\
    channel_id VARCHAR(20),\
    FOREIGN KEY (settings_id)\
        REFERENCES "settings" (id),\
    FOREIGN KEY (user_id)\
        REFERENCES users (id)\
  );`,
  `CREATE TABLE IF NOT EXISTS offers (\
    collection VARCHAR(100) NOT NULL,\
    created_at TIMESTAMP NOT NULL,\
    PRIMARY KEY (collection, created_at),\
    ends_at TIMESTAMP NOT NULL,\
    price SMALLINT NOT NULL,\
    token_id VARCHAR(100)\
  );`,
  `CREATE TABLE IF NOT EXISTS floor_prices (\
    collection VARCHAR(100) NOT NULL,\
    created_at TIMESTAMP NOT NULL,\
    PRIMARY KEY (collection, created_at),\
    price SMALLINT NOT NULL\
  );`,
];

export const setUpDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
  dbName = DB_NAME,
}) => {
  console.log(`Set up DB`);
  const pool = new Pool({
    host,
    port,
    user,
    database: dbName,
    password,
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });
  await Promise.all(createTableQueries.map((query) => client.query(query)));
  await client.release();
  return pool.end();
};

export const clearDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
  dbName = DB_NAME,
}) => {
  console.log(`Set up DB`);
  const pool = new Pool({
    host,
    port,
    user,
    database: dbName,
    password,
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });
  await client.query(`TRUNCATE settings, users, alerts, offers, floor_prices`);
  await client.release();
  return pool.end();
};

export const createDbClient = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
  dbName = DB_NAME,
}) => {
  const pool = new Pool({
    host,
    port,
    user,
    database: dbName,
    password,
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });

  const getUserByDiscordId = async (discordId) => {
    const { rows } = await client.query(
      `SELECT * FROM users WHERE discord_id = $1`,
      [discordId]
    );
    console.log(`User with discord id ${discordId}: ${JSON.stringify(rows)}`);
    return rows;
  };

  const createAlert = async () => Promise.resolve({});

  const setAlertNickname = async () => Promise.resolve({});

  const deleteAlert = async () => Promise.resolve({});

  const createUser = async ({
    discordId,
    alarmLimit = DEFAULT_USER_ALARM_LIMIT,
    addresses,
    tokens,
  }) => Promise.resolve(true);

  // Also returns the settings associated to either
  // the alert or the user if the alert has no settings
  const getAlertsByAddress = async () => Promise.resolve([]);

  const getAllUsers = async () => Promise.resolve([]);

  const getUsers = async (ids) => Promise.resolve([]);

  const getUserAlerts = async () => Promise.resolve([]);

  const addUserAddress = async () => Promise.resolve({});

  const deleteUserAddress = async () => Promise.resolve({});

  const setUserTokens = async () => Promise.resolve({});

  const setMaxFloorDifference = async () => Promise.resolve({});

  const setAllowedEvents = async () => Promise.resolve({});

  const setAllowedMarketplaces = async () => Promise.resolve({});

  const getAllOffers = async () => Promise.resolve({});

  const setCollectionOffer = async () => Promise.resolve({});

  const destroy = async () => {
    await client.release();
    return pool.end();
  };

  return {
    getUserByDiscordId,
    createAlert,
    setAlertNickname,
    deleteAlert,
    createUser,
    getAlertsByAddress,
    getAllUsers,
    getUsers,
    getUserAlerts,
    addUserAddress,
    deleteUserAddress,
    setUserTokens,
    setMaxFloorDifference,
    setAllowedEvents,
    setAllowedMarketplaces,
    getAllOffers,
    setCollectionOffer,
    destroy,
  };
};
