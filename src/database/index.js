import { readFileSync } from "fs";
import process from "process";
import path from "path";
import dotenv from "dotenv";
import postgre from "pg";

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const { Pool } = postgre;

dotenv.config({ path: path.resolve(".env") });

const {
  DB_HOSTNAME,
  DB_PORT,
  DB_USERNAME,
  DB_NAME,
  DB_PASSWORD,
  DEFAULT_USER_ALARM_LIMIT = 3,
  DEFAULT_SERVER_ALARM_LIMIT = 1,
  DEFAULT_MAX_OFFER_FLOOR_DISTANCE = 15,
  DEFAULT_ALLOWED_MARKETPLACES = allMarketplaceIds,
  DEFAULT_ALLOWED_EVENTS = allEventIds,
} = process.env;

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
  `CREATE TYPE alert_type AS ENUM ('wallet', 'collection')`,
  `CREATE TABLE IF NOT EXISTS settings (\
    id serial PRIMARY KEY,\
    max_offer_floor_difference SMALLINT,\
    allowed_marketplaces TEXT [],\
    allowed_events TEXT []\
  );`,
  `CREATE TABLE IF NOT EXISTS users (\
    id serial PRIMARY KEY,\
    settings_id INT NOT NULL,\
    discord_id VARCHAR(20),\
    UNIQUE (discord_id),\
    created_at TIMESTAMPTZ NOT NULL,\
    alarm_limit SMALLINT NOT NULL,\
    addresses TEXT [],\
    tokens TEXT [],\
    FOREIGN KEY (settings_id)\
        REFERENCES settings (id)\
  );`,
  `CREATE TABLE IF NOT EXISTS alerts (\
    id serial PRIMARY KEY,\
    type alert_type,\
    settings_id INT NOT NULL,\
    user_id INT NOT NULL,\
    nickname VARCHAR(50),\
    UNIQUE (user_id, nickname),\
    UNIQUE (user_id, address),\
    address VARCHAR(100) NOT NULL,\
    created_at TIMESTAMPTZ NOT NULL,\
    channel_id VARCHAR(20),\
    FOREIGN KEY (settings_id)\
        REFERENCES "settings" (id),\
    FOREIGN KEY (user_id)\
        REFERENCES users (id)\
  );`,
  `CREATE TABLE IF NOT EXISTS offers (\
    collection VARCHAR(100) NOT NULL,\
    token_id VARCHAR(100),\
    PRIMARY KEY (collection, token_id),\
    created_at TIMESTAMPTZ NOT NULL,\
    ends_at TIMESTAMPTZ NOT NULL,\
    price SMALLINT NOT NULL\
  );`,
  `CREATE TABLE IF NOT EXISTS floor_prices (\
    collection VARCHAR(100) NOT NULL,\
    created_at TIMESTAMPTZ NOT NULL,\
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

export const removeDb = async ({
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
  // await client.query(`REVOKE CONNECT ON DATABASE "${dbName}" FROM public`);
  await client.query(`DROP DATABASE "${dbName}"`);
  await client.release();
  return pool.end();
};

const toSettingsObject = (settings) => {
  if (settings == null) {
    return null;
  }

  const {
    max_offer_floor_difference: maxOfferFloorDifference,
    allowed_marketplaces: allowedMarketplaces,
    allowed_events: allowedEvents,
    ...props
  } = settings;
  return {
    ...props,
    maxOfferFloorDifference,
    allowedMarketplaces,
    allowedEvents,
  };
};

const toUserObject = (user) => {
  if (user == null) {
    return null;
  }

  const {
    settings_id: settingsId,
    discord_id: discordId,
    created_at: createdAt,
    alarm_limit: alarmLimit,
    max_offer_floor_difference: maxOfferFloorDifference,
    allowed_marketplaces: allowedMarketplaces,
    allowed_events: allowedEvents,
    ...props
  } = user;
  return {
    ...props,
    maxOfferFloorDifference,
    allowedMarketplaces,
    allowedEvents,
    settingsId,
    discordId,
    createdAt,
    alarmLimit,
  };
};

const toAlertObject = (alert) => {
  if (alert == null) {
    return null;
  }

  const {
    settings_id: settingsId,
    user_id: userId,
    created_at: createdAt,
    channel_id: channelId,
    max_offer_floor_difference: maxOfferFloorDifference,
    allowed_marketplaces: allowedMarketplaces,
    allowed_events: allowedEvents,
    ...props
  } = alert;
  return {
    ...props,
    settingsId,
    userId,
    createdAt,
    channelId,
    maxOfferFloorDifference:
      maxOfferFloorDifference == null
        ? DEFAULT_MAX_OFFER_FLOOR_DISTANCE
        : maxOfferFloorDifference,
    allowedMarketplaces:
      allowedMarketplaces == null
        ? DEFAULT_ALLOWED_MARKETPLACES
        : allowedMarketplaces,
    allowedEvents:
      allowedEvents == null ? DEFAULT_ALLOWED_EVENTS : allowedEvents,
  };
};

const toOfferObject = (offer) => {
  if (offer == null) {
    return null;
  }

  const {
    token_id: tokenId,
    ends_at: endsAt,
    created_at: createdAt,
    ...props
  } = offer;
  return {
    ...props,
    tokenId,
    endsAt,
    createdAt,
  };
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

  const getUserByDiscordId = async ({ discordId } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", object: null };
    }

    const { rows } = await client.query(
      `SELECT * FROM users
      LEFT JOIN settings\
      ON settings.id = users.settings_id\
      WHERE discord_id = $1`,
      [discordId]
    );
    return {
      result: rows.length > 0 ? "success" : "missing-user",
      object: toUserObject(rows[0]),
    };
  };

  const createUser = async ({
    discordId,
    type = "user",
    addresses = [],
    tokens = [],
    maxOfferFloorDifference = DEFAULT_MAX_OFFER_FLOOR_DISTANCE,
    allowedMarketplaces = DEFAULT_ALLOWED_MARKETPLACES,
    allowedEvents = DEFAULT_ALLOWED_EVENTS,
  } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", object: null };
    }

    const alarmLimit =
      type === "user" ? DEFAULT_USER_ALARM_LIMIT : DEFAULT_SERVER_ALARM_LIMIT;
    const values = [
      maxOfferFloorDifference,
      allowedMarketplaces,
      allowedEvents,
      discordId,
      alarmLimit,
      addresses,
      tokens,
      new Date(),
    ];
    return client
      .query(
        `WITH new_settings AS (
          INSERT INTO settings (max_offer_floor_difference, allowed_marketplaces, allowed_events) VALUES ($1, $2, $3) returning id
        ) \
        INSERT INTO users (discord_id, alarm_limit, addresses, tokens, created_at, settings_id) VALUES($4, $5, $6, $7, $8, (SELECT * from new_settings)) RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toUserObject(rows[0]),
        };
      })
      .catch((error) => {
        console.log(
          `Error inserting user with values ${JSON.stringify(values)}`,
          error
        );
        const { constraint } = error;
        return {
          object: null,
          result:
            constraint === "users_discord_id_key" ? "already-exists" : "error",
        };
      });
  };

  const createAlert = async ({
    discordId,
    userId: providedUserId,
    channelId,
    nickname,
    address,
    type,
    maxOfferFloorDifference = DEFAULT_MAX_OFFER_FLOOR_DISTANCE,
    allowedMarketplaces = DEFAULT_ALLOWED_MARKETPLACES,
    allowedEvents = DEFAULT_ALLOWED_EVENTS,
  } = {}) => {
    // At least one id is necessary to associate an alert to a user
    if (discordId == null && providedUserId == null) {
      return { result: "missing-arguments", object: null };
    }

    let userId = providedUserId;
    if (providedUserId == null) {
      const { object: user } = await getUserByDiscordId(discordId);
      if (user == null) {
        return { result: "missing-user", object: null };
      }

      userId = user.id;
    }

    const values = [
      maxOfferFloorDifference,
      allowedMarketplaces,
      allowedEvents,
      type,
      userId,
      address,
      new Date(),
    ];
    const props = ["type", "user_id", "address", "created_at"];
    if (nickname) {
      values.push(nickname);
      props.push("nickname");
    }

    if (channelId) {
      values.push(channelId);
      props.push("channel_id");
    }

    const propsQuery = props.join(", ");
    // We have to add 4 to take into account that pg expects
    //  1-indexed references and that we have to skip the
    // first 3 values, which are used for settings
    const valuesQuery = values
      .slice(3)
      .map((_, index) => `$${index + 4}`)
      .join(", ");
    return client
      .query(
        `WITH new_settings AS (
          INSERT INTO settings (max_offer_floor_difference, allowed_marketplaces, allowed_events) VALUES ($1, $2, $3) returning id
        ) \
        INSERT INTO alerts (${propsQuery}, settings_id) VALUES (${valuesQuery}, (SELECT * from new_settings)) RETURNING *`,
        values
      )
      .then(({ rows }) => {
        return {
          result: rows.length > 0 ? "success" : "error",
          object: toAlertObject(rows[0]),
        };
      })
      .catch((error) => {
        console.log(
          `Error creating alert with props ${JSON.stringify(
            props
          )} and values ${JSON.stringify(values)}: ${JSON.stringify(error)}`
        );
        const { constraint } = error;
        return {
          object: null,
          result:
            constraint === "alerts_user_id_address_key"
              ? "already-exists"
              : "missing-user",
        };
      });
  };

  const setAlertNickname = async ({ discordId, address, nickname } = {}) => {
    if (discordId == null || address == null || nickname == null) {
      return { result: "missing-arguments", object: null };
    }

    const { rows } = await client.query(
      `UPDATE alerts SET nickname = $3 WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND address = $2 RETURNING *`,
      [discordId, address, nickname]
    );
    return {
      result: rows.length > 0 ? "success" : "error",
      object: toAlertObject(rows[0]),
    };
  };

  const deleteAlert = async ({ discordId, address, nickname } = {}) => {
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
      values = [discordId, address];
    }

    const result = await client.query(
      `DELETE from alerts WHERE user_id = (SELECT user_id FROM users WHERE discord_id = $1) AND ${identifierCondition} RETURNING *`,
      values
    );
    console.log(`DELETE alert result: ${JSON.stringify(result)}`);
    return {
      result: result.rowCount > 0 ? "success" : "missing-alert",
      object: result.rows[0],
    };
  };

  // Also returns the settings associated to either
  // the alert or the user if the alert has no settings
  const getAlertsByAddress = async ({ address } = {}) => {
    if (address == null) {
      return { result: "missing-arguments", objects: [] };
    }

    const { rows } = await client.query(
      `SELECT *, alerts.id FROM alerts\
      LEFT JOIN settings\
      ON settings.id = alerts.settings_id\
      WHERE address = $1`,
      [address]
    );
    return { result: "success", objects: rows.map(toAlertObject) };
  };

  const getAllUsers = async () => {
    const { rows } = await client.query(`SELECT * FROM users`);
    return { result: "success", objects: rows.map(toUserObject) };
  };

  const getUsers = async ({ ids } = {}) => {
    if (ids == null) {
      return { result: "missing-arguments", objects: [] };
    }

    if (ids.length === 0) {
      return { result: "success", objects: [] };
    }

    const idsReference = ids.map((_, index) => `$${index + 1}`).join(", ");
    const { rows } = await client.query(
      `SELECT * FROM users\
      LEFT JOIN settings\
      ON settings.id = users.settings_id\
      WHERE users.id IN (${idsReference})`,
      ids
    );
    return { result: "success", objects: rows.map(toUserObject) };
  };

  const getUserAlerts = async ({ discordId } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", objects: [] };
    }

    const { rows } = await client.query(
      `SELECT *, alerts.id FROM alerts\
      LEFT JOIN settings\
      ON settings.id = alerts.settings_id\
      WHERE user_id = (SELECT id FROM users WHERE discord_id = $1)`,
      [discordId]
    );
    return { result: "success", objects: rows.map(toAlertObject) };
  };

  const addUserAddress = async ({ discordId, addresses, tokens = [] } = {}) => {
    if (discordId == null || addresses == null) {
      return { result: "missing-arguments", object: null };
    }

    const result = await client.query(
      `UPDATE users\
      SET addresses = array_cat(addresses, $2), tokens = array_cat(tokens, $3)\
      WHERE discord_id = $1\
      RETURNING *`,
      [discordId, addresses, tokens]
    );
    const { rows } = result;
    return {
      result: rows.length > 0 ? "success" : "missing-user",
      object: toUserObject(rows[0]),
    };
  };

  const deleteUserAddresses = async ({
    discordId,
    addresses,
    tokens = [],
  } = {}) => {
    if (discordId == null || addresses == null) {
      return { result: "missing-arguments", object: null };
    }

    const result = await client.query(
      `UPDATE users\
      SET addresses =\
        (SELECT array(SELECT unnest (addresses::TEXT[]) EXCEPT SELECT unnest ($2::TEXT[]))),\
      tokens =\
        (SELECT array(SELECT unnest (tokens::TEXT[]) EXCEPT SELECT unnest ($3::TEXT[])))\
      WHERE discord_id = $1\
      RETURNING *`,
      [discordId, addresses, tokens]
    );
    const { rows } = result;
    return {
      result: rows.length > 0 ? "success" : "missing-user",
      object: toUserObject(rows[0]),
    };
  };

  const setUserTokens = async ({ id, tokens } = {}) => {
    if (id == null || tokens == null) {
      return { result: "missing-arguments", object: null };
    }

    const result = await client.query(
      `UPDATE users\
      SET tokens = $2\
      WHERE id = $1\
      RETURNING *`,
      [id, tokens]
    );
    const { rows } = result;
    return {
      result: rows.length > 0 ? "success" : "missing-user",
      object: toUserObject(rows[0]),
    };
  };

  const setMaxFloorDifference = async ({
    discordId,
    address,
    maxOfferFloorDifference,
  } = {}) => {
    if (discordId == null || maxOfferFloorDifference == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, maxOfferFloorDifference];
    let condition =
      "id = (SELECT settings_id FROM users WHERE discord_id = $1)";
    if (address != null) {
      values.push(address);
      condition =
        "id = (SELECT settings_id FROM alerts WHERE address = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    }

    const response = await client.query(
      `UPDATE settings SET max_offer_floor_difference = $2 WHERE ${condition} RETURNING *`,
      values
    );
    const { rows } = response;
    return {
      result:
        rows.length > 0
          ? "success"
          : address == null
          ? "missing-user"
          : "missing-alert",
      object: toSettingsObject(rows[0]),
    };
  };

  const setAllowedEvents = async ({
    discordId,
    address,
    allowedEvents,
  } = {}) => {
    if (discordId == null || allowedEvents == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, allowedEvents];
    let condition =
      "id = (SELECT settings_id FROM users WHERE discord_id = $1)";
    if (address != null) {
      values.push(address);
      condition =
        "id = (SELECT settings_id FROM alerts WHERE address = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    }

    const response = await client.query(
      `UPDATE settings SET allowed_events = $2 WHERE ${condition} RETURNING *`,
      values
    );
    const { rows } = response;
    return {
      result:
        rows.length > 0
          ? "success"
          : address == null
          ? "missing-user"
          : "missing-alert",
      object: toSettingsObject(rows[0]),
    };
  };

  const setAllowedMarketplaces = async ({
    discordId,
    address,
    allowedMarketplaces,
  } = {}) => {
    if (discordId == null || allowedMarketplaces == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, allowedMarketplaces];
    let condition =
      "id = (SELECT settings_id FROM users WHERE discord_id = $1)";
    if (address != null) {
      values.push(address);
      condition =
        "id = (SELECT settings_id FROM alerts WHERE address = $3 AND user_id = (SELECT id from users WHERE discord_id = $1))";
    }

    const response = await client.query(
      `UPDATE settings SET allowed_marketplaces = $2 WHERE ${condition} RETURNING *`,
      values
    );
    const { rows } = response;
    return {
      result:
        rows.length > 0
          ? "success"
          : address == null
          ? "missing-user"
          : "missing-alert",
      object: toSettingsObject(rows[0]),
    };
  };

  const getAllCollectionOffers = async () => {
    const { rows } = await client.query(`SELECT * FROM offers\
    WHERE token_id = ''`);
    return { result: "success", objects: rows.map(toOfferObject) };
  };

  const setCollectionOffer = async ({ address, price, endsAt } = {}) => {
    if (address == null || price == null || endsAt == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [address, price, new Date(endsAt), new Date(), ""];
    const { rows } = await client.query(
      `INSERT INTO offers (collection, price, ends_at, created_at, token_id)\
      VALUES($1, $2, $3, $4, $5)\
      ON CONFLICT (collection, token_id)\
      DO\
        UPDATE SET collection = $1, price = $2, ends_at = $3, created_at = $4, token_id = $5\
      RETURNING *`,
      values
    );
    return {
      result: rows.length > 0 ? "success" : "error",
      object: toOfferObject(rows[0]),
    };
  };

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
    deleteUserAddresses,
    setUserTokens,
    setMaxFloorDifference,
    setAllowedEvents,
    setAllowedMarketplaces,
    getAllCollectionOffers,
    setCollectionOffer,
    destroy,
  };
};
