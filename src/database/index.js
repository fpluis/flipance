/* eslint-disable no-await-in-loop */

/// <reference path="../../src/typedefs.js" />

import process from "process";
import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";
import postgre from "pg";
import logMessage from "../log-message.js";

const { Pool } = postgre;

dotenv.config({ path: path.resolve(".env") });

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);
const allBlockchainIds = [{ id: "eth" }].map(({ id }) => id);
const allStandardIds = [{ id: "ERC-721" }, { id: "ERC-1155" }].map(
  ({ id }) => id
);

const DEFAULT_ALLOWED_EVENT_IDS = ["offer", "acceptOffer", "acceptAsk"];

const {
  DB_HOSTNAME,
  DB_PORT,
  POSTGRES_USERNAME,
  DB_NAME,
  POSTGRES_PASSWORD = "",
  MAX_NICKNAME_LENGTH = 50,
  DEFAULT_USER_ALERT_LIMIT = 3,
  DEFAULT_SERVER_ALERT_LIMIT = 1,
  MAX_OFFER_FLOOR_DIFFERENCE = 15,
} = process.env;

/**
 *
 * Returns true if a database with the name 'dbName' provided exists.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {Boolean}
 */
export const isDbCreated = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
  const pool = new Pool({
    host,
    port,
    user,
    password,
    database: "postgres",
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });

  const dbExistsResult = await client.query(
    `SELECT datname FROM pg_catalog.pg_database WHERE datname=$1`,
    [dbName]
  );
  await client.release();
  await pool.end();
  return dbExistsResult.rows.length === 0
    ? false
    : dbExistsResult.rows[0].datname === dbName;
};

/**
 *
 * Creates a database and returns true if it doesn't exist. If the
 * database already exists, returns false and doesn't change anything.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {Boolean}
 */
export const createDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
  const dbExists = await isDbCreated({ host, port, user, password, dbName });
  if (dbExists) {
    return false;
  }

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database: "postgres",
  });

  pool.on("error", (error) => {
    console.error("Unexpected error on client", error);
  });

  const client = await pool.connect().catch((error) => {
    throw error;
  });

  await client.query(`CREATE DATABASE "${dbName}" WITH ENCODING 'UTF8'`);
  logMessage({ message: `Created DB "${dbName}"` });
  await client.release();
  return pool.end().then(() => true);
};

const createTableQueries = [
  `CREATE TYPE alert_type AS ENUM ('wallet', 'server', 'collection')`,
  `CREATE TYPE order_type AS ENUM ('listing', 'offer')`,
  `CREATE TABLE IF NOT EXISTS settings (\
    id serial PRIMARY KEY,\
    max_offer_floor_difference DOUBLE PRECISION,\
    allowed_marketplaces TEXT [],\
    allowed_events TEXT []\
  );`,
  `CREATE TABLE IF NOT EXISTS users (\
    id serial PRIMARY KEY,\
    settings_id INT NOT NULL,\
    discord_id VARCHAR(20),\
    UNIQUE (discord_id),\
    created_at TIMESTAMPTZ NOT NULL,\
    alert_limit SMALLINT NOT NULL,\
    FOREIGN KEY (settings_id)\
        REFERENCES settings (id)\
  );`,
  `CREATE TABLE IF NOT EXISTS alerts (\
    id serial PRIMARY KEY,\
    type alert_type,\
    settings_id INT NOT NULL,\
    user_id INT NOT NULL,\
    nickname VARCHAR(${MAX_NICKNAME_LENGTH}),\
    UNIQUE (user_id, nickname),\
    UNIQUE (user_id, address),\
    address CHAR(42) NOT NULL,\
    tokens TEXT [],\
    created_at TIMESTAMPTZ NOT NULL,\
    synced_at TIMESTAMPTZ NOT NULL,\
    channel_id VARCHAR(20),\
    FOREIGN KEY (settings_id)\
        REFERENCES "settings" (id),\
    FOREIGN KEY (user_id)\
        REFERENCES users (id)\
  );`,
  `CREATE TABLE IF NOT EXISTS offers (\
    collection CHAR(42) NOT NULL,\
    token_id VARCHAR(100),\
    PRIMARY KEY (collection, token_id),\
    created_at TIMESTAMPTZ NOT NULL,\
    ends_at TIMESTAMPTZ NOT NULL,\
    marketplace VARCHAR(16),\
    price DOUBLE PRECISION NOT NULL,\
    order_hash TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS floor_prices (\
    collection CHAR(42) NOT NULL,\
    created_at TIMESTAMPTZ NOT NULL,\
    ends_at TIMESTAMPTZ NOT NULL,\
    PRIMARY KEY (collection, created_at),\
    marketplace VARCHAR(16),\
    price DOUBLE PRECISION NOT NULL,\
    order_hash TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS nft_events (\
    id serial PRIMARY KEY,\
    transaction_hash CHAR(66),\
    order_hash TEXT,\
    created_at TIMESTAMPTZ NOT NULL,\
    starts_at TIMESTAMPTZ,\
    ends_at TIMESTAMPTZ,\
    token_id VARCHAR(100),\
    event_type SMALLINT,\
    blockchain SMALLINT NOT NULL,\
    marketplace SMALLINT,\
    UNIQUE (transaction_hash, event_type, collection, token_id),\
    UNIQUE (order_hash, marketplace),\
    collection CHAR(42),\
    initiator CHAR(42),\
    buyer CHAR(42),\
    seller CHAR(42),\
    intermediary CHAR(42),\
    gas INT,\
    amount INT,\
    metadata_uri TEXT,\
    standard SMALLINT,\
    order_type SMALLINT,\
    is_highest_offer BOOLEAN,\
    collection_floor DOUBLE PRECISION,\
    floor_difference NUMERIC(12, 4),\
    price DOUBLE PRECISION\
  );`,
  `CREATE TABLE IF NOT EXISTS db_flags (\
    name TEXT,\
    PRIMARY KEY (name),\
    value BOOLEAN\
  );`,
];

const patchDBQueries = [
  `ALTER TABLE nft_events ADD order_type order_type;`,
  `ALTER TABLE nft_events RENAME COLUMN hash TO transaction_hash;`,
  `ALTER TABLE nft_events ALTER transaction_hash DROP NOT NULL`,
  `ALTER TABLE nft_events ADD order_hash TEXT;`,
  `DELETE FROM nft_events events_1
    USING nft_events events_2
   WHERE events_1.id < events_2.id
    AND events_1.order_hash = events_2.order_hash;`,
  `ALTER TABLE nft_events DROP CONSTRAINT order_hash_starts_at;`,
  `ALTER TABLE nft_events DROP CONSTRAINT order_hash_marketplace;`,
  `ALTER TABLE nft_events ADD CONSTRAINT order_hash_marketplace_event_type UNIQUE (order_hash, marketplace, event_type);`,
  `ALTER TABLE offers ADD order_hash TEXT;`,
  `ALTER TABLE floor_prices ADD order_hash TEXT;`,
  `DROP TABLE IF EXISTS sharding_info;`,
];

/**
 *
 * Patch the DB to apply the latest changes to tables/constraints
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {void}
 */
const patchDB = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
}) => {
  logMessage({ message: `Patch DB` });
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
  let index = 0;
  while (index < patchDBQueries.length) {
    const query = patchDBQueries[index];
    await client.query(query).catch((error) => {
      logMessage({
        message: `Error handling query "${query}":`,
        level: "error",
        error,
      });
    });
    index += 1;
  }

  const { rows: clearOrdersFlag } = await client.query(
    `SELECT * FROM db_flags WHERE name = 'clear_orders'`
  );
  if (clearOrdersFlag.length === 0) {
    await Promise.all([
      client.query(`DELETE FROM floor_prices; DELETE FROM offers`),
      client.query(
        `INSERT INTO db_flags (name, value) VALUES ('clear_orders', TRUE)`
      ),
    ]);
  }

  await client.release();
  return pool.end();
};

/**
 *
 * Runs the queries to create the Flipance tables that do not exist.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {void}
 */
export const setUpDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
  logMessage({ message: `Set up DB` });
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
  await Promise.all(
    createTableQueries.map((query) =>
      client.query(query).catch((error) => {
        logMessage({
          message: `Error handling query "${query}":`,
          level: "error",
          error,
        });
      })
    )
  ).then(() =>
    patchDB({
      host,
      port,
      user,
      password,
      dbName,
    })
  );
  await client.release();
  return pool.end();
};

/**
 *
 * Destroys all the Flipance tables in the database provided.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {void}
 */
export const clearDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
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
  await client.query(
    `TRUNCATE settings, users, alerts, offers, floor_prices, nft_events`
  );
  await client.release();
  return pool.end();
};

/**
 *
 * Destroys the database provided.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 * @return {void}
 */
export const removeDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
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
  await client.query(`DROP DATABASE "${dbName}"`).catch((error) => {
    logMessage({ message: `Error dropping db`, level: "error", error });
  });
  await client.release();
  return pool.end();
};

const serializeEventType = (eventType) =>
  allEventIds.findIndex((type) => type === eventType);

const deserializeEventType = (serializedEventType) =>
  allEventIds[serializedEventType];

const serializeMarketplace = (marketplaceId) =>
  allMarketplaceIds.findIndex((id) => id === marketplaceId);

const deserializeMarketplace = (serializedMarketplaceId) =>
  allMarketplaceIds[serializedMarketplaceId];

const serializeBlockchain = (blockchainId) =>
  allBlockchainIds.findIndex((id) => id === blockchainId);

const deserializeBlockchain = (serializedBlockchainId) =>
  allBlockchainIds[serializedBlockchainId];

const serializeStandard = (standardId) =>
  allStandardIds.findIndex((id) => id === standardId);

const deserializeStandard = (serializedStandardId) =>
  allStandardIds[serializedStandardId];

/**
 *
 * Maps a Settings object from the database to a JS object and sets some
 * settings to the global defaults if the object does not have them.
 * @param {Object} settings
 * @return {Settings}
 */
const toSettingsObject = (settings) => {
  if (settings == null) {
    return null;
  }

  const {
    max_offer_floor_difference,
    allowed_marketplaces,
    allowed_events,
    ...props
  } = settings;
  return {
    ...props,
    maxOfferFloorDifference:
      max_offer_floor_difference == null
        ? Number(MAX_OFFER_FLOOR_DIFFERENCE)
        : max_offer_floor_difference,
    allowedMarketplaces:
      allowed_marketplaces == null
        ? allMarketplaceIds
        : allowed_marketplaces.map(deserializeMarketplace),
    allowedEvents:
      allowed_events == null
        ? DEFAULT_ALLOWED_EVENT_IDS
        : allowed_events.map(deserializeEventType),
  };
};

/**
 * Maps a User object (and a Settings object, if present) from the database to a JS object.
 * @param {Object} user
 * @return {User}
 */
const toUserObject = (user) => {
  if (user == null) {
    return null;
  }

  const {
    settings_id: settingsId,
    discord_id: discordId,
    created_at: createdAt,
    alert_limit: alertLimit,
    ...props
  } = user;
  return {
    ...props,
    ...toSettingsObject(props),
    settingsId,
    discordId,
    createdAt,
    alertLimit,
  };
};

/**
 * Maps an Alert object (and a Settings object, if present) from the database to a JS object. If a specific setting for the alert is missing and the user object was provided, the setting from the user will be returned.
 * @param {Object} alert
 * @return {Alert}
 */
const toAlertObject = (alert) => {
  if (alert == null) {
    return null;
  }

  const {
    discordId,
    discord_id: alertDiscordId = discordId,
    settings_id: settingsId,
    user_id: userId,
    created_at: createdAt,
    synced_at: syncedAt,
    channel_id: channelId,
    alert_max_offer_floor_difference,
    alert_allowed_marketplaces,
    alert_allowed_events,
    user_max_offer_floor_difference,
    user_allowed_marketplaces,
    user_allowed_events,
    ...props
  } = alert;
  return {
    ...props,
    discordId: alertDiscordId,
    settingsId,
    userId,
    createdAt,
    syncedAt,
    channelId,
    maxOfferFloorDifference:
      alert_max_offer_floor_difference == null
        ? user_max_offer_floor_difference == null
          ? Number(MAX_OFFER_FLOOR_DIFFERENCE)
          : user_max_offer_floor_difference
        : alert_max_offer_floor_difference,
    allowedMarketplaces:
      alert_allowed_marketplaces == null
        ? user_allowed_marketplaces == null
          ? allMarketplaceIds
          : user_allowed_marketplaces.map(deserializeMarketplace)
        : alert_allowed_marketplaces.map(deserializeMarketplace),
    allowedEvents:
      alert_allowed_events == null
        ? user_allowed_events == null
          ? DEFAULT_ALLOWED_EVENT_IDS
          : user_allowed_events.map(deserializeEventType)
        : alert_allowed_events.map(deserializeEventType),
  };
};

/**
 *
 * Maps an Offer object from the database to a JS object.
 * @param {Object} offer
 * @return {Offer}
 */
const toOfferObject = (offer) => {
  if (offer == null) {
    return null;
  }

  const {
    token_id: tokenId,
    ends_at: endsAt,
    created_at: createdAt,
    order_hash: orderHash,
    marketplace,
    ...props
  } = offer;
  return {
    ...props,
    orderHash,
    marketplace: deserializeMarketplace(marketplace),
    tokenId,
    endsAt,
    createdAt,
  };
};

/**
 *
 * Maps a Collection floor object from the database to a JS object.
 * @param {Object} collectionFloor
 * @return {CollectionFloor}
 */
const toCollectionFloorObject = (collectionFloor) => {
  if (collectionFloor == null) {
    return null;
  }

  const {
    created_at: createdAt,
    ends_at: endsAt,
    order_hash: orderHash,
    marketplace,
    ...props
  } = collectionFloor;
  return {
    ...props,
    orderHash,
    marketplace: deserializeMarketplace(marketplace),
    endsAt,
    createdAt,
  };
};

/**
 *
 * Maps an NFT Event object from the database to a JS object.
 * @param {Object} NFTEvent
 * @return {NFTEvent}
 */
const toNFTEventObject = (nftEvent) => {
  if (nftEvent == null) {
    return null;
  }

  const {
    transaction_hash: transactionHash,
    order_hash: orderHash,
    created_at: createdAt,
    starts_at: startsAt,
    ends_at: endsAt,
    event_type,
    marketplace,
    blockchain,
    standard,
    token_id: tokenId,
    metadata_uri: metadataUri,
    is_highest_offer: isHighestOffer = false,
    floor_difference: floorDifference,
    collection_floor: collectionFloor,
    order_type: orderType,
    ...props
  } = nftEvent;
  const eventType = deserializeEventType(event_type);
  if (props.watchers) {
    props.watchers = props.watchers.map(toAlertObject);
  }

  return {
    ...props,
    transactionHash,
    orderHash,
    createdAt,
    startsAt,
    endsAt,
    eventType,
    marketplace: deserializeMarketplace(marketplace),
    blockchain: deserializeBlockchain(blockchain),
    standard: deserializeStandard(standard),
    isHighestOffer,
    floorDifference: Number(floorDifference),
    collectionFloor,
    orderType,
    tokenId,
    metadataUri,
  };
};

/**
 *
 * Creates a client to interact with the underlying database. Call the destroy
 * function to close the connection.
 * @param {Object} params
 * @param {String} params.host The database's hostname. Default: "localhost"
 * @param {Number} params.port The database's port. Default: 5432
 * @param {String} params.user The database's user. Default: "postgres"
 * @param {String} params.password The user's password.
 * @param {String} params.dbName The database's name. Default: "flipance"
 */
export const createDbClient = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = POSTGRES_USERNAME,
  password = POSTGRES_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
  const pool = new Pool({
    host,
    port,
    user,
    database: dbName,
    password,
  });

  pool.on("error", (error) => {
    console.error("Database client error", error);
    logMessage({ message: `Database client error`, level: "error", error });
  });

  const client = await pool.connect().catch((error) => {
    logMessage({
      message: `Database client connection error`,
      level: "error",
      error,
    });
    throw error;
  });

  /**
   *
   * Queries the database for a user with the provided discordId
   * @param {Object} params
   * @param {String} params.discordId - The user's discord id.
   * @typedef {("success"|"missing-arguments"|"missing-user"|"already-exists"|"error")} UserResultType - The result of executing the user query.
   * @typedef {Object} UserResponse - The response of a query for a user object.
   * @property {UserResultType} result
   * @property {User|null} object
   * @return {UserResponse}
   */
  const getUserByDiscordId = ({ discordId } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", object: null };
    }

    return client
      .query(
        `SELECT *, users.id AS id FROM users
      LEFT JOIN settings\
      ON settings.id = users.settings_id\
      WHERE discord_id = $1`,
        [discordId]
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "missing-user",
          object: toUserObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting user by discord id ${discordId}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Creates a user with the default settings for the specified discordId.
   * @param {Object} params
   * @param {String} params.discordId - The user's discord id.
   * @param {("user"|"server")} params.type - The user's type.
   * @return {UserResponse}
   */
  const createUser = ({ discordId, type = "user" } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", object: null };
    }

    const alertLimit =
      type === "user" ? DEFAULT_USER_ALERT_LIMIT : DEFAULT_SERVER_ALERT_LIMIT;
    const values = [discordId, alertLimit, new Date()];
    return client
      .query(
        `WITH new_settings AS (
          INSERT INTO settings (max_offer_floor_difference, allowed_marketplaces, allowed_events) VALUES (NULL, NULL, NULL) returning id
        ) \
        INSERT INTO users (discord_id, alert_limit, created_at, settings_id) VALUES($1, $2, $3, (SELECT id from new_settings)) RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toUserObject(rows[0]),
        };
      })
      .catch((error) => {
        const { constraint } = error;
        return {
          object: null,
          result:
            constraint === "users_discord_id_key" ? "already-exists" : "error",
        };
      });
  };

  /**
   *
   * Creates a user with the default settings for the specified discordId.
   * @param {Object} params
   * @param {String} params.discordId - The discord id of the user creating the alert. Either the discord id OR the user id must be provided.
   * @param {String} params.userId - The user id of the user creating the alert. Either the discord id OR the user id must be provided.
   * @typedef {("success"|"missing-arguments"|"missing-user"|"missing-alert")} AlertResultType - The result of executing the query.
   * @typedef {Object} AlertResponse - The responses returned by alert-modifying database functions.
   * @property {AlertResultType} result - The query's result.
   * @property {Alert|null} object - The new alert.
   * @return {AlertResponse}
   */
  const createAlert = async ({
    discordId,
    userId: providedUserId,
    channelId,
    nickname,
    address,
    tokens = [],
    type,
  } = {}) => {
    // At least one id is necessary to associate an alert to a user
    if (discordId == null && providedUserId == null) {
      return { result: "missing-arguments", object: null };
    }

    let userId = providedUserId;
    if (providedUserId == null) {
      const { object: user } = await getUserByDiscordId({ discordId });
      if (user == null) {
        return { result: "missing-user", object: null };
      }

      userId = user.id;
    }

    const values = [
      type,
      userId,
      address.toLowerCase(),
      tokens,
      new Date(),
      new Date(),
    ];
    const props = [
      "type",
      "user_id",
      "address",
      "tokens",
      "created_at",
      "synced_at",
    ];
    if (nickname) {
      values.push(nickname);
      props.push("nickname");
    }

    if (channelId) {
      values.push(channelId);
      props.push("channel_id");
    }

    const propsQuery = props.join(", ");
    const valuesQuery = values.map((_, index) => `$${index + 1}`).join(", ");
    return client
      .query(
        `WITH alert_settings AS (
          INSERT INTO settings (max_offer_floor_difference, allowed_marketplaces, allowed_events) VALUES (NULL, NULL, NULL) returning id
        ) \
        INSERT INTO alerts (${propsQuery}, settings_id) VALUES (${valuesQuery}, (SELECT * from alert_settings)) RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toAlertObject(rows[0]),
        };
      })
      .catch((error) => {
        const { constraint, code, routine } = error;
        return {
          object: null,
          result: [
            "alerts_user_id_address_key",
            "alerts_user_id_nickname_key",
          ].includes(constraint)
            ? "already-exists"
            : code === "22001" && routine === "varchar"
            ? "nickname-too-long"
            : "missing-user",
        };
      });
  };

  const alertSettingsSelectProps =
    "alert_settings.max_offer_floor_difference as alert_max_offer_floor_difference, alert_settings.allowed_marketplaces as alert_allowed_marketplaces, alert_settings.allowed_events as alert_allowed_events, user_settings.max_offer_floor_difference as user_max_offer_floor_difference, user_settings.allowed_marketplaces as user_allowed_marketplaces, user_settings.allowed_events as user_allowed_events";

  /**
   *
   * Sets the nickname for an alert.
   * @param {Object} params
   * @param {String} params.discordId - (Required) The discord id of the user creating the alert.
   * @param {String} params.address - (Required) The alert's address.
   * @param {String} params.nickname - (Required) The alert's nickname.
   * @return {AlertResponse}
   */
  const setAlertNickname = ({ discordId, address, nickname } = {}) => {
    if (discordId == null || address == null || nickname == null) {
      return { result: "missing-arguments", object: null };
    }

    return client
      .query(
        `WITH alert_info AS (
          UPDATE alerts a
          SET nickname = $3
          WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND address = $2
          RETURNING *
        )
        SELECT *, alert_info.id, ${alertSettingsSelectProps} FROM alert_info\
        LEFT JOIN settings AS alert_settings\
        ON alert_settings.id = alert_info.settings_id\
        LEFT JOIN settings AS user_settings\
        ON user_settings.id = (\
          SELECT settings_id FROM users WHERE users.discord_id = $1)`,
        [discordId, address.toLowerCase(), nickname]
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "missing-alert",
          object: toAlertObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error setting an alert's nickname with args ${JSON.stringify(
            {
              discordId,
              address,
              nickname,
            }
          )}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Deletes an alert specified by either address or nickname.
   * @param {Object} params
   * @param {String} params.discordId - (Required) The discord id of the user creating the alert.
   * @param {String} params.address - (Required) The alert's address. Either the address OR the nickname must be provided.
   * @param {String} params.nickname - (Required) The alert's nickname. Either the address OR the nickname must be provided.
   * @return {AlertResponse}
   */
  const deleteAlert = ({ discordId, address, nickname } = {}) => {
    if (discordId == null || (address == null && nickname == null)) {
      return { result: "missing-arguments", object: null };
    }

    let values;
    let identifierCondition;
    if (address == null) {
      identifierCondition = `nickname = $2`;
      values = [discordId, nickname];
    } else {
      identifierCondition = `address = $2`;
      values = [discordId, address.toLowerCase()];
    }

    return client
      .query(
        `DELETE from alerts WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND ${identifierCondition} RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "missing-alert",
          object: toAlertObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error deleting alert with args ${JSON.stringify({
            discordId,
            address,
            nickname,
          })}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Gets all the alerts specified for the target address.
   * @param {Object} params
   * @param {String} params.address - (Required) The Ethereum address.
   * @typedef {Object} AlertsResponse - The responses returned by alert-modifying database functions that affect multiple alerts.
   * @property {AlertResultType} result - The query's result.
   * @property {Alert[]} objects - The new alerts.
   * @return {AlertsResponse}
   */
  const getAlertsByAddress = ({ address } = {}) => {
    if (address == null) {
      return { result: "missing-arguments", objects: [] };
    }

    return client
      .query(
        `SELECT *, alerts.id, users.discord_id AS discord_id, ${alertSettingsSelectProps} FROM alerts\
        LEFT JOIN settings AS alert_settings\
        ON alert_settings.id = alerts.settings_id\
        LEFT JOIN settings AS user_settings\
        ON user_settings.id = (\
          SELECT settings_id FROM users WHERE users.id = alerts.user_id)\
        LEFT JOIN users\
        ON users.id = alerts.user_id\
        WHERE address = $1`,
        [address.toLowerCase()]
      )
      .then(({ rows }) => {
        return { result: "success", objects: rows.map(toAlertObject) };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting alerts by address "${address}"`,
          level: "error",
          error,
        });
        return { result: "error", objects: [] };
      });
  };

  /**
   *
   * Gets all the alerts for a user with a specific discordId that have a set nickname.
   * @param {Object} params
   * @param {String} params.discordId - (Required) The user's discord id.
   * @param {String} params.nickname - (Required) The alert's nickname.
   * @return {AlertsResponse}
   */
  const getAlertsByNickname = ({ discordId, nickname } = {}) => {
    if (discordId == null || nickname == null) {
      return { result: "missing-arguments", objects: [] };
    }

    return client
      .query(
        `SELECT *, alerts.id, ${alertSettingsSelectProps} FROM alerts\
        LEFT JOIN settings AS alert_settings\
        ON alert_settings.id = alerts.settings_id\
        LEFT JOIN settings AS user_settings\
        ON user_settings.id = (\
          SELECT settings_id FROM users WHERE users.discord_id = $2)\
        WHERE nickname = $1 AND user_id = (SELECT id FROM users WHERE discord_id = $2)`,
        [nickname, discordId]
      )
      .then(({ rows }) => {
        return { result: "success", objects: rows.map(toAlertObject) };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting alerts by nickname with args ${JSON.stringify(
            {
              discordId,
              nickname,
            }
          )}`,
          level: "error",
          error,
        });
        return { result: "error", objects: [] };
      });
  };

  /**
   *
   * Gets all the alerts in the database.
   * @return {AlertsResponse}
   */
  const getAllAlerts = () => {
    return client
      .query(
        `SELECT *, alerts.id, users.discord_id AS discord_id, ${alertSettingsSelectProps} FROM alerts\
        LEFT JOIN users\
        ON users.id = alerts.user_id\
        LEFT JOIN settings AS alert_settings\
        ON alert_settings.id = alerts.settings_id\
        LEFT JOIN settings AS user_settings\
        ON user_settings.id = (\
          SELECT settings_id FROM users WHERE users.id = alerts.user_id)`
      )
      .then(({ rows }) => {
        return {
          result: "success",
          objects: rows.map((row) => toAlertObject(toUserObject(row))),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting all alerts`,
          level: "error",
          error,
        });
        return { result: "error", objects: [] };
      });
  };

  /**
   *
   * Gets all the alerts for the user with the provided discord id.
   * @param {Object} params
   * @param {String} params.discordId - (Required) The user's discord id.
   * @return {AlertsResponse}
   */
  const getUserAlerts = ({ discordId } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", objects: [] };
    }

    return client
      .query(
        `SELECT *, alerts.id, ${alertSettingsSelectProps} FROM alerts\
      LEFT JOIN settings AS alert_settings\
      ON alert_settings.id = alerts.settings_id\
      LEFT JOIN settings AS user_settings\
      ON user_settings.id = (\
        SELECT settings_id FROM users WHERE users.discord_id = $1)
      WHERE user_id = (SELECT id FROM users WHERE discord_id = $1)`,
        [discordId]
      )
      .then(({ rows }) => {
        return { result: "success", objects: rows.map(toAlertObject) };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting user alerts with discordId "${discordId}"`,
          level: "error",
          error,
        });
        return { result: "error", objects: [] };
      });
  };

  /**
   *
   * Sets the tokens for an alert.
   * @param {Object} params
   * @param {String} params.id - (Required) The alert's id.
   * @param {String[]} params.tokens - (Required) The new tokens that will completely overwrite the old ones.
   * @return {AlertResponse}
   */
  const setAlertTokens = ({ id, tokens } = {}) => {
    if (id == null || tokens == null) {
      return { result: "missing-arguments", object: null };
    }

    return client
      .query(
        `UPDATE alerts\
      SET tokens = $2, synced_at = $3\
      WHERE id = $1\
      RETURNING *`,
        [id, tokens, new Date()]
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "missing-alert",
          object: toAlertObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error setting an alert's tokens with args ${JSON.stringify({
            id,
            tokens,
          })}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Set the maxFloorDifference setting for a user or an alert.
   * @param {Object} params
   * @param {String} params.discordId (Required) The Discord id of the user
   * who wants to modify their own settings.
   * @param {Number} params.maxOfferFloorDifference (Required) The new maximum
   * offer difference to the floor, expressed as a percentage (i.e. 0.2 = 20%).
   * @param {String} params.address (Optional) The address of the alert to edit.
   * If provided, the settings of the alert and NOT the user will be edited.
   * @param {String} params.nickname (Optional) The nickname of the alert to
   * edit. If provided, the settings of the alert and NOT the user will
   * be edited.
   * @typedef {("success"|"missing-arguments"|"missing-user"|"missing-alert")} SettingsResultType - The result of executing the query.
   * @typedef {Object} SettingsResponse - The response returned by settings-modifying database functions.
   * @property {SettingsResultType} result - The query's result.
   * @property {Settings|null} object - The new settings.
   * @return {SettingsResponse} response
   */
  const setMaxFloorDifference = ({
    discordId,
    address,
    nickname,
    maxOfferFloorDifference,
  } = {}) => {
    if (discordId == null || maxOfferFloorDifference == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, maxOfferFloorDifference];
    let condition =
      "id = (SELECT settings_id FROM users WHERE discord_id = $1)";
    if (address != null) {
      values.push(address.toLowerCase());
      condition =
        "id = (SELECT settings_id FROM alerts WHERE address = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    } else if (nickname != null) {
      values.push(nickname);
      condition =
        "id = (SELECT settings_id FROM alerts WHERE nickname = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    }

    return client
      .query(
        `UPDATE settings SET max_offer_floor_difference = $2 WHERE ${condition} RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result:
            rows.length > 0
              ? "success"
              : address == null
              ? "missing-user"
              : "missing-alert",
          object: toSettingsObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error setting max floor difference with args ${JSON.stringify(
            {
              discordId,
              address,
              nickname,
              maxOfferFloorDifference,
            }
          )}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Set the allowedEvents setting for a user or an alert.
   * @param {Object} params
   * @param {String} params.discordId (Required) The Discord id of the user
   * who wants to modify their own settings.
   * @param {EventType[]} params.allowedEvents (Required) The new allowed events.
   * @param {String} params.address (Optional) The address of the alert to edit.
   * If provided, the settings of the alert and NOT the user will be edited.
   * @param {String} params.nickname (Optional) The nickname of the alert to
   * edit. If provided, the settings of the alert and NOT the user will
   * be edited.
   * @return {SettingsResponse} response
   */
  const setAllowedEvents = ({
    discordId,
    address,
    nickname,
    allowedEvents,
  } = {}) => {
    if (discordId == null || allowedEvents == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, allowedEvents.map(serializeEventType)];
    let condition =
      "id = (SELECT settings_id FROM users WHERE discord_id = $1)";
    if (address != null) {
      values.push(address.toLowerCase());
      condition =
        "id = (SELECT settings_id FROM alerts WHERE address = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    } else if (nickname != null) {
      values.push(nickname);
      condition =
        "id = (SELECT settings_id FROM alerts WHERE nickname = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    }

    return client
      .query(
        `UPDATE settings SET allowed_events = $2 WHERE ${condition} RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result:
            rows.length > 0
              ? "success"
              : address == null
              ? "missing-user"
              : "missing-alert",
          object: toSettingsObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error setting allowed events with args ${JSON.stringify({
            discordId,
            address,
            nickname,
            allowedEvents,
          })}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Set the allowedMarketplaces setting for a user or an alert.
   * @param {Object} params
   * @param {String} params.discordId (Required) The Discord id of the user
   * who wants to modify their own settings.
   * @param {Marketplace[]} params.allowedMarketplaces (Required) The new allowed marketplaces.
   * @param {String} params.address (Optional) The address of the alert to edit.
   * If provided, the settings of the alert and NOT the user will be edited.
   * @param {String} params.nickname (Optional) The nickname of the alert to
   * edit. If provided, the settings of the alert and NOT the user will
   * be edited.
   * @return {SettingsResponse} response
   */
  const setAllowedMarketplaces = ({
    discordId,
    address,
    nickname,
    allowedMarketplaces,
  } = {}) => {
    if (discordId == null || allowedMarketplaces == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, allowedMarketplaces.map(serializeMarketplace)];
    let condition =
      "id = (SELECT settings_id FROM users WHERE discord_id = $1)";
    if (address != null) {
      values.push(address.toLowerCase());
      condition =
        "id = (SELECT settings_id FROM alerts WHERE address = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    } else if (nickname != null) {
      values.push(nickname);
      condition =
        "id = (SELECT settings_id FROM alerts WHERE nickname = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    }

    return client
      .query(
        `UPDATE settings SET allowed_marketplaces = $2 WHERE ${condition} RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result:
            rows.length > 0
              ? "success"
              : address == null
              ? "missing-user"
              : "missing-alert",
          object: toSettingsObject(rows[0]),
        };
      })
      .catch((error) => {
        logMessage({
          message: `Error setting allowed marketplaces with args ${JSON.stringify(
            {
              discordId,
              address,
              nickname,
              allowedMarketplaces,
            }
          )}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Get the current collection floor for a collection.
   * @param {Object} params
   * @param {String} params.collection - The collection's Ethereum address.
   * @typedef {("success"|"missing-arguments"|"error")} CollectionFloorResultType - The result of executing the query.
   * @typedef {Object} CollectionFloorResponse - The responses returned by collection floor database functions.
   * @property {CollectionFloorResultType} result - The query's result.
   * @property {CollectionFloor|null} object - The collection floor.
   * @return {CollectionFloorResponse} response
   */
  const getOffer = ({ collection, tokenId = "" } = {}) => {
    if (collection == null) {
      return { result: "missing-arguments", object: null };
    }

    const tokenIds = tokenId == null ? [""] : [tokenId, ""];
    return client
      .query(
        `SELECT * FROM offers\
      WHERE collection = $1 AND token_id = ANY($2::TEXT[])`,
        [collection.toLowerCase(), tokenIds]
      )
      .then(({ rows }) => {
        if (rows.length > 1) {
          const sortedByPrice = rows.sort(
            ({ price: price1 }, { price: price2 }) => price2 - price1
          );
          return { result: "success", object: toOfferObject(sortedByPrice[0]) };
        }

        return { result: "success", object: toOfferObject(rows[0]) };
      })
      .catch((error) => {
        logMessage({
          messages: `Error getting collection offer with args ${JSON.stringify({
            collection,
          })}`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Create a new highest offer for a collection and/or specific token.
   * @typedef {Object} OfferResponse - The responses returned by offer database functions.
   * @property {OfferResultType} result - The query's result.
   * @property {Offer|null} object - The new offer.
   * @return {OfferResponse} response
   */
  const setOffer = ({
    collection,
    orderHash,
    price,
    endsAt,
    marketplace = "looksRare",
    tokenId = "",
  } = {}) => {
    if (collection == null || price == null || endsAt == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [
      collection.toLowerCase(),
      orderHash ? orderHash.toLowerCase() : null,
      price,
      new Date(endsAt),
      new Date(),
      serializeMarketplace(marketplace),
      tokenId == null ? "" : tokenId,
    ];
    return client
      .query(
        `INSERT INTO offers (collection, order_hash, price, ends_at, created_at, marketplace, token_id)\
      VALUES($1, $2, $3, $4, $5, $6, $7)\
      ON CONFLICT (collection, token_id)\
      DO\
        UPDATE SET collection = $1, order_hash = $2, price = $3, ends_at = $4, created_at = $5, marketplace = $6, token_id = $7\
      RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toOfferObject(rows[0]),
        };
      })
      .catch((error) => {
        const { constraint } = error;
        if (constraint !== "offers_pkey") {
          const { stack } = new Error();
          logMessage({
            message: `Error setting collection offer with args`,
            args: JSON.stringify({
              collection,
              price,
              endsAt,
              marketplace,
              orderHash,
            }),
            level: "error",
            error,
            stack,
          });
        }

        return {
          object: null,
          result: constraint === "offers_pkey" ? "already-exists" : "error",
        };
      });
  };

  /**
   *
   * Get the current collection floor for a collection.
   * @param {Object} params
   * @param {String} params.collection - The collection's Ethereum address.
   * @typedef {("success"|"missing-arguments"|"error")} CollectionFloorResultType - The result of executing the query.
   * @typedef {Object} CollectionFloorResponse - The responses returned by collection floor database functions.
   * @property {CollectionFloorResultType} result - The query's result.
   * @property {CollectionFloor|null} object - The collection floor.
   * @return {CollectionFloorResponse} response
   */
  const getCollectionFloor = ({ collection } = {}) => {
    if (collection == null) {
      return { result: "missing-arguments", object: null };
    }

    return client
      .query(
        `SELECT * FROM floor_prices\
      WHERE collection = $1\
      ORDER BY created_at DESC`,
        [collection.toLowerCase()]
      )
      .then(({ rows }) => {
        return { result: "success", object: toCollectionFloorObject(rows[0]) };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting collection floor of "${collection}"`,
          level: "error",
          error,
        });
        return { result: "error", object: null };
      });
  };

  /**
   *
   * Set the current collection floor for a collection.
   * @param {Object} params
   * @param {String} params.collection - The collection's Ethereum address.
   * @param {Number} params.price - The collection's floor in Ether.
   * @param {Marketplace} params.marketplace - The collection's Ethereum address.
   * @return {CollectionFloorResponse}
   */
  const setCollectionFloor = ({
    collection,
    orderHash,
    price,
    endsAt,
    marketplace = "looksRare",
  } = {}) => {
    if (collection == null || price == null || endsAt == null) {
      return { result: "missing-arguments", object: null };
    }

    return client
      .query(
        `INSERT INTO floor_prices (collection, order_hash, created_at, price, marketplace, ends_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          collection.toLowerCase(),
          orderHash ? orderHash.toLowerCase() : null,
          new Date(),
          price,
          serializeMarketplace(marketplace),
          new Date(endsAt),
        ]
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toCollectionFloorObject(rows[0]),
        };
      })
      .catch((error) => {
        const { constraint } = error;
        if (constraint !== "floor_prices_pkey") {
          logMessage({
            messages: `Error setting collection floor with args ${JSON.stringify(
              {
                collection,
                price,
                endsAt,
                marketplace,
              }
            )}`,
            level: "error",
            error,
          });
        }

        return {
          object: null,
          result:
            constraint === "floor_prices_pkey" ? "already-exists" : "error",
        };
      });
  };

  /**
   *
   * Adds an NFT Event to the database. The only constraint is that there are no events with the same blockchain, hash, eventType, collection, tokenId, buyer and seller. Note that this constraint is so elaborate because a single transaction can buy a token and resell it, which counts as two separate events.
   * @param {NFTEvent} nftEvent
   * @typedef {Object} NFTEventResponse - The responses returned by database functions that affect NFT events.
   * @property {NFTEventResultType} result - The query's result.
   * @property {NFTEventResponse[]} object - The new NFT event.
   * @return {NFTEventResponse}
   */
  const addNFTEvent = (nftEvent = {}) => {
    const {
      transactionHash,
      orderHash,
      eventType,
      startsAt,
      endsAt,
      tokenId,
      blockchain = allBlockchainIds[0],
      marketplace,
      collection,
      initiator,
      intermediary,
      buyer,
      seller,
      gas,
      amount,
      metadataUri,
      standard = "ERC-721",
      price,
      isHighestOffer = false,
      collectionFloor,
      floorDifference,
      orderType,
    } = nftEvent;
    // At least one id is necessary to associate an alert to a user
    if (
      (transactionHash == null && orderHash == null) ||
      (collection == null && eventType !== "cancelOrder") ||
      eventType == null
    ) {
      return { result: "missing-arguments", object: null };
    }

    const values = [
      new Date(),
      serializeEventType(eventType),
      serializeBlockchain(blockchain),
      serializeMarketplace(marketplace),
    ];
    const props = ["created_at", "event_type", "blockchain", "marketplace"];
    const optionalProps = [
      { value: transactionHash, name: "transaction_hash" },
      { value: orderHash, name: "order_hash" },
      { value: startsAt, name: "starts_at" },
      { value: endsAt, name: "ends_at" },
      { value: tokenId, name: "token_id" },
      {
        value: collection ? collection.toLowerCase() : collection,
        name: "collection",
      },
      {
        value: initiator ? initiator.toLowerCase() : initiator,
        name: "initiator",
      },
      { value: buyer ? buyer.toLowerCase() : buyer, name: "buyer" },
      { value: seller ? seller.toLowerCase() : seller, name: "seller" },
      { value: intermediary, name: "intermediary" },
      { value: gas, name: "gas" },
      { value: amount, name: "amount" },
      {
        value:
          metadataUri == null
            ? metadataUri
            : // eslint-disable-next-line no-control-regex
              metadataUri.replace(/\u0000/giu, ""),
        name: "metadata_uri",
      },
      { value: serializeStandard(standard), name: "standard" },
      { value: isHighestOffer, name: "is_highest_offer" },
      {
        value: collectionFloor,
        name: "collection_floor",
      },
      {
        value:
          price === 0 || collectionFloor === 0 || floorDifference == null
            ? null
            : Math.min(floorDifference, 10 ** 7),
        name: "floor_difference",
      },
      {
        value: orderType,
        name: "order_type",
      },
      { value: price, name: "price" },
    ];
    optionalProps.forEach(({ value, name }) => {
      if (value != null) {
        values.push(value);
        props.push(name);
      }
    });

    const propsQuery = props.join(", ");
    const valuesQuery = values.map((_, index) => `$${index + 1}`).join(", ");
    return client
      .query(
        `INSERT INTO nft_events (${propsQuery}) VALUES (${valuesQuery}) RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toNFTEventObject(rows[0]),
        };
      })
      .catch((error) => {
        const { constraint } = error;
        if (
          ![
            "nft_events_hash_event_type_collection_token_id_key",
            "unique_hash_timestamp",
            "nft_events_hash_starts_at_key",
            "order_hash_marketplace_event_type",
            "transaction_hash_event_type_collection_token_id",
          ].includes(constraint)
        ) {
          logMessage({
            message: `Error creating NFT event with args ${JSON.stringify(
              nftEvent
            )}`,
            level: "error",
            error,
          });
          return { result: "warning", objects: [] };
        }

        return {
          object: null,
          result:
            constraint === "nft_events_hash_event_type_collection_token_id_key"
              ? "already-exists"
              : "error",
        };
      });
  };

  /**
   *
   * Get all the NFT events after the 'createdAt' Date.
   * @param {Object} params
   * @param {Date} params.createdAt - The Date after which to retrieve events.
   * @typedef {Object} NFTEventsResponse - The responses returned by database functions that affect multiple NFT events.
   * @property {NFTEventResultType} result - The query's result.
   * @property {NFTEventResponse[]} objects - The new NFT events.
   * @return {NFTEventsResponse}
   */
  const getNFTEvents = ({ createdAt } = {}) => {
    if (createdAt == null) {
      return { result: "missing-arguments", objects: [] };
    }

    return client
      .query(
        `SELECT * FROM nft_events\
        WHERE created_at >= $1\
        ORDER BY created_at DESC`,
        [createdAt]
      )
      .then(({ rows }) => {
        return { result: "success", objects: rows.map(toNFTEventObject) };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting NFT events since ${createdAt}`,
          level: "error",
          error,
        });
        return { result: "error", objects: [] };
      });
  };

  /**
   *
   * Get all the NFT events after the 'createdAt' Date as well as the alerts currently watching any of the addresses involved.
   * @param {Object} params
   * @param {Date} params.createdAt - The Date after which to retrieve events.
   * @param {Date} params.createdAt - The Date after which to retrieve events.
   * @typedef {Object} NFTEventsResponse - The responses returned by database functions that affect multiple NFT events.
   * @property {NFTEventResultType} result - The query's result.
   * @property {NFTEventResponse[]} objects - The new NFT events.
   * @return {NFTEventsResponse}
   */
  const getWatchedNFTEvents = ({ createdAt, minId = 0 } = {}) => {
    if (createdAt == null) {
      return { result: "missing-arguments", objects: [] };
    }

    const buildWatcherObjectQuery = `json_build_object('alert_id', alerts.id, 'address', alerts.address, 'nickname', alerts.nickname, 'discord_id', users.discord_id, 'channel_id', alerts.channel_id, 'type', alerts.type, 'tokens', alerts.tokens, 'alert_max_offer_floor_difference', alert_settings.max_offer_floor_difference, 'alert_allowed_marketplaces', alert_settings.allowed_marketplaces, 'alert_allowed_events', alert_settings.allowed_events, 'user_max_offer_floor_difference', user_settings.max_offer_floor_difference, 'user_allowed_marketplaces', user_settings.allowed_marketplaces, 'user_allowed_events', user_settings.allowed_events)`;
    return client
      .query(
        `SELECT nft_events.*, COALESCE(alerts.watchers, '[]') AS watchers\
        FROM nft_events\
        LEFT JOIN LATERAL(\
          SELECT json_agg(${buildWatcherObjectQuery}) AS watchers\
          FROM alerts\
          LEFT JOIN users\
            ON users.id = alerts.user_id\
            LEFT JOIN settings AS alert_settings\
            ON alert_settings.id = alerts.settings_id\
            LEFT JOIN settings AS user_settings\
            ON user_settings.id = (\
              SELECT settings_id FROM users WHERE users.id = alerts.user_id)
          WHERE alerts.address = nft_events.buyer OR alerts.address = nft_events.seller OR alerts.address = nft_events.collection OR alerts.address = nft_events.initiator OR CONCAT(nft_events.collection, '/', nft_events.token_id) = ANY(alerts.tokens)\
        ) alerts ON true\
        WHERE nft_events.created_at >= $1 AND nft_events.id > $2\
        ORDER BY created_at DESC`,
        [createdAt, minId]
      )
      .then(({ rows }) => {
        return { result: "success", objects: rows.map(toNFTEventObject) };
      })
      .catch((error) => {
        logMessage({
          message: `Error getting watched NFT events since ${createdAt}`,
          level: "error",
          error,
        });
        return { result: "error", objects: [] };
      });
  };

  /**
   *
   * Destroys the client's connection to the database.
   * @return {void}
   */
  const destroy = async () => {
    await client.release();
    return pool.end();
  };

  return {
    getUserByDiscordId,
    createAlert,
    setAlertNickname,
    deleteAlert,
    setAlertTokens,
    createUser,
    getAlertsByAddress,
    getAlertsByNickname,
    getAllAlerts,
    getUserAlerts,
    setMaxFloorDifference,
    setAllowedEvents,
    setAllowedMarketplaces,
    getOffer,
    setOffer,
    getCollectionFloor,
    setCollectionFloor,
    addNFTEvent,
    getNFTEvents,
    getWatchedNFTEvents,
    destroy,
  };
};
