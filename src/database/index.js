/* eslint-disable no-multi-str */
import process from "process";
import path from "path";
import dotenv from "dotenv";
import postgre from "pg";

const { Pool } = postgre;

dotenv.config({ path: path.resolve(".env") });

const { DB_HOSTNAME, DB_PORT, DB_USERNAME, DB_NAME, DB_PASSWORD } = process.env;
const isTestMode = process.argv.includes("--test");

console.log(`Is test mode? ${isTestMode}`);

export default async () => {
  const host = DB_HOSTNAME;
  const port = DB_PORT;
  const user = DB_USERNAME;
  const password = DB_PASSWORD;
  const pool = new Pool({
    host,
    port,
    user,
    database: DB_NAME,
    password,
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on client", err);
  });

  const client = await pool.connect().catch((err) => {
    client.release();
    console.log(err.stack);
    process.exit(-1);
  });

  const getDiscordUserSettings = async (discordId) => {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE discord_id = $1`,
      [discordId]
    );
    console.log(`Settings for user ${discordId}: ${JSON.stringify(rows)}`);
    return rows;
  };

  const createAlert = async () => {};

  const deleteAlert = async () => {};

  // Also returns the settings associated to either
  // the alert or the user if the alert has no settings
  const getAlertsByWallet = async () => {};

  const getAllUsers = async () => {};

  const getUsers = async (ids) => {};

  const getUser = async () => {};

  const getUserAlerts = async () => {};

  const addUserAddress = async () => {};

  const deleteUserAddress = async () => {};

  const setUserTokens = async () => {};

  const setUserMaxFloorDifference = async () => {};

  const setUserAllowedEvents = async () => {};

  const setserAllowedMarketplaces = async () => {};

  const getAllOffers = async () => {};

  const setCollectionOffer = async () => {};

  return {
    getDiscordUserSettings,
    createAlert,
    deleteAlert,
    getAlertsByWallet,
    getAllUsers,
    getUsers,
    getUser,
    getUserAlerts,
    addUserAddress,
    deleteUserAddress,
    setUserTokens,
    setUserMaxFloorDifference,
    setUserAllowedEvents,
    setserAllowedMarketplaces,
    getAllOffers,
    setCollectionOffer,
  };
};
