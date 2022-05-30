import process from "process";
import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";
import postgre from "pg";

const { Pool } = postgre;

dotenv.config({ path: path.resolve(".env") });

const marketplaces = JSON.parse(readFileSync("data/marketplaces.json"));
const nftEvents = JSON.parse(readFileSync("data/nft-events.json"));

const allMarketplaceIds = marketplaces.map(({ id }) => id);
const allEventIds = nftEvents.map(({ id }) => id);

const {
  DB_HOSTNAME,
  DB_PORT,
  DB_USERNAME,
  DB_NAME,
  DB_PASSWORD = "",
  MAX_NICKNAME_LENGTH = 50,
  DEFAULT_USER_ALARM_LIMIT = 3,
  DEFAULT_SERVER_ALARM_LIMIT = 1,
  MAX_OFFER_FLOOR_DIFFERENCE = 15,
} = process.env;

export const isDbCreated = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
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

export const createDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
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
  console.log(`Created DB "${dbName}"`);
  await client.release();
  return pool.end().then(() => true);
};

const createTableQueries = [
  `CREATE TYPE alert_type AS ENUM ('wallet', 'collection')`,
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
    address VARCHAR(100) NOT NULL,\
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
    collection VARCHAR(100) NOT NULL,\
    token_id VARCHAR(100),\
    PRIMARY KEY (collection, token_id),\
    created_at TIMESTAMPTZ NOT NULL,\
    ends_at TIMESTAMPTZ NOT NULL,\
    marketplace TEXT NOT NULL,\
    price DOUBLE PRECISION NOT NULL\
  );`,
  `CREATE TABLE IF NOT EXISTS floor_prices (\
    collection VARCHAR(100) NOT NULL,\
    created_at TIMESTAMPTZ NOT NULL,\
    PRIMARY KEY (collection, created_at),\
    marketplace TEXT NOT NULL,\
    price DOUBLE PRECISION NOT NULL\
  );`,
];

export const setUpDb = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
  dbName = DB_NAME,
} = {}) => {
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
  await client.query(`DROP DATABASE "${dbName}"`);
  await client.release();
  return pool.end();
};

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
      allowed_marketplaces == null ? allMarketplaceIds : allowed_marketplaces,
    allowedEvents: allowed_events == null ? allEventIds : allowed_events,
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

// If a specific setting is missing, the setting from the user
// will be returned, if provided.
const toAlertObject = (alert) => {
  if (alert == null) {
    return null;
  }

  const {
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
    settingsId,
    userId,
    createdAt,
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
          : user_allowed_marketplaces
        : alert_allowed_marketplaces,
    allowedEvents:
      alert_allowed_events == null
        ? user_allowed_events == null
          ? allEventIds
          : user_allowed_events
        : alert_allowed_events,
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

const toCollectionFloorObject = (collectionFloor) => {
  if (collectionFloor == null) {
    return null;
  }

  const { created_at: createdAt, ...props } = collectionFloor;
  return {
    ...props,
    createdAt,
  };
};

export const createDbClient = async ({
  host = DB_HOSTNAME,
  port = DB_PORT,
  user = DB_USERNAME,
  password = DB_PASSWORD,
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

  const getUserByDiscordId = async ({ discordId } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", object: null };
    }

    const { rows } = await client.query(
      `SELECT *, users.id AS id FROM users
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

  const createUser = async ({ discordId, type = "user" } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", object: null };
    }

    const alertLimit =
      type === "user" ? DEFAULT_USER_ALARM_LIMIT : DEFAULT_SERVER_ALARM_LIMIT;
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

  const setAlertNickname = async ({ discordId, address, nickname } = {}) => {
    if (discordId == null || address == null || nickname == null) {
      return { result: "missing-arguments", object: null };
    }

    const { rows } = await client.query(
      `UPDATE alerts SET nickname = $3 WHERE user_id = (SELECT id FROM users WHERE discord_id = $1) AND address = $2 RETURNING *`,
      [discordId, address.toLowerCase(), nickname]
    );
    return {
      result: rows.length > 0 ? "success" : "missing-alert",
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
      values = [discordId, address.toLowerCase()];
    }

    const result = await client.query(
      `DELETE from alerts WHERE user_id = (SELECT user_id FROM users WHERE discord_id = $1) AND ${identifierCondition} RETURNING *`,
      values
    );
    return {
      result: result.rowCount > 0 ? "success" : "missing-alert",
      object: result.rows[0],
    };
  };

  const alertSettingsSelectProps =
    "alert_settings.max_offer_floor_difference as alert_max_offer_floor_difference, alert_settings.allowed_marketplaces as alert_allowed_marketplaces, alert_settings.allowed_events as alert_allowed_events, user_settings.max_offer_floor_difference as user_max_offer_floor_difference, user_settings.allowed_marketplaces as user_allowed_marketplaces, user_settings.allowed_events as user_allowed_events";

  // Also returns the settings associated to the alert and user.
  const getAlertsByAddress = async ({ address } = {}) => {
    if (address == null) {
      return { result: "missing-arguments", objects: [] };
    }

    const result = await client.query(
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
    );
    const { rows } = result;
    return { result: "success", objects: rows.map(toAlertObject) };
  };

  const getAlertsByNickname = async ({ discordId, nickname } = {}) => {
    if (discordId == null || nickname == null) {
      return { result: "missing-arguments", objects: [] };
    }

    const { rows } = await client.query(
      `SELECT *, alerts.id, ${alertSettingsSelectProps} FROM alerts\
      LEFT JOIN settings AS alert_settings\
      ON alert_settings.id = alerts.settings_id\
      LEFT JOIN settings AS user_settings\
      ON user_settings.id = (\
        SELECT settings_id FROM users WHERE users.discord_id = $2)\
      WHERE nickname = $1 AND user_id = (SELECT id FROM users WHERE discord_id = $2)`,
      [nickname, discordId]
    );
    return { result: "success", objects: rows.map(toAlertObject) };
  };

  const getAllAlerts = async () => {
    const { rows } =
      await client.query(`SELECT *, alerts.id, users.discord_id AS discord_id, ${alertSettingsSelectProps} FROM alerts\
        LEFT JOIN users\
        ON users.id = alerts.user_id\
        LEFT JOIN settings AS alert_settings\
        ON alert_settings.id = alerts.settings_id\
        LEFT JOIN settings AS user_settings\
        ON user_settings.id = (\
          SELECT settings_id FROM users WHERE users.id = alerts.user_id)`);
    return {
      result: "success",
      objects: rows.map((row) => toAlertObject(toUserObject(row))),
    };
  };

  const getUserAlerts = async ({ discordId } = {}) => {
    if (discordId == null) {
      return { result: "missing-arguments", objects: [] };
    }

    const { rows } = await client.query(
      `SELECT *, alerts.id, ${alertSettingsSelectProps} FROM alerts\
      LEFT JOIN settings AS alert_settings\
      ON alert_settings.id = alerts.settings_id\
      LEFT JOIN settings AS user_settings\
      ON user_settings.id = (\
        SELECT settings_id FROM users WHERE users.discord_id = $1)
      WHERE user_id = (SELECT id FROM users WHERE discord_id = $1)`,
      [discordId]
    );
    return { result: "success", objects: rows.map(toAlertObject) };
  };

  const setAlertTokens = async ({ id, tokens } = {}) => {
    if (id == null || tokens == null) {
      return { result: "missing-arguments", object: null };
    }

    const result = await client.query(
      `UPDATE alerts\
      SET tokens = $2, synced_at = $3\
      WHERE id = $1\
      RETURNING *`,
      [id, tokens, new Date()]
    );
    const { rows } = result;
    return {
      result: rows.length > 0 ? "success" : "missing-alert",
      object: toUserObject(rows[0]),
    };
  };

  const setMaxFloorDifference = async ({
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
    nickname,
    allowedEvents,
  } = {}) => {
    if (discordId == null || allowedEvents == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, allowedEvents];
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
    nickname,
    allowedMarketplaces,
  } = {}) => {
    if (discordId == null || allowedMarketplaces == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [discordId, allowedMarketplaces];
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

  const setCollectionOffer = async ({
    address,
    price,
    endsAt,
    marketplace = "looksRare",
  } = {}) => {
    if (address == null || price == null || endsAt == null) {
      return { result: "missing-arguments", object: null };
    }

    const values = [
      address.toLowerCase(),
      price,
      new Date(endsAt),
      new Date(),
      marketplace,
      "",
    ];
    const { rows } = await client.query(
      `INSERT INTO offers (collection, price, ends_at, created_at, marketplace, token_id)\
      VALUES($1, $2, $3, $4, $5, $6)\
      ON CONFLICT (collection, token_id)\
      DO\
        UPDATE SET collection = $1, price = $2, ends_at = $3, created_at = $4, marketplace = $5, token_id = $6\
      RETURNING *`,
      values
    );
    return {
      result: rows.length > 0 ? "success" : "error",
      object: toOfferObject(rows[0]),
    };
  };

  const getCollectionFloor = async ({ collection } = {}) => {
    if (collection == null) {
      return { result: "missing-arguments", object: null };
    }

    const { rows } = await client.query(
      `SELECT * FROM floor_prices\
      WHERE collection = $1\
      ORDER BY created_at DESC`,
      [collection]
    );
    return { result: "success", object: toCollectionFloorObject(rows[0]) };
  };

  const setCollectionFloor = async ({
    collection,
    price,
    marketplace = "looksRare",
  } = {}) => {
    if (collection == null || price == null) {
      return { result: "missing-arguments", object: null };
    }

    const { rows } = await client.query(
      `INSERT INTO floor_prices (collection, created_at, price, marketplace) VALUES ($1, $2, $3, $4) RETURNING *`,
      [collection, new Date(), price, marketplace]
    );
    return {
      result: rows.length > 0 ? "success" : "error",
      object: toCollectionFloorObject(rows[0]),
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
    setAlertTokens,
    createUser,
    getAlertsByAddress,
    getAlertsByNickname,
    getAllAlerts,
    getUserAlerts,
    setMaxFloorDifference,
    setAllowedEvents,
    setAllowedMarketplaces,
    getAllCollectionOffers,
    setCollectionOffer,
    getCollectionFloor,
    setCollectionFloor,
    destroy,
  };
};
