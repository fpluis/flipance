/*
  This script will create or update in-place the Flipance database with the latest schema.
*/

import path from "path";
import dotenv from "dotenv";
import { createDb, setUpDb, isDbCreated } from "../src/database/index.js";
import logMessage from "../src/log-message.js";

dotenv.config({ path: path.resolve(".env") });

const setUp = async () => {
  const dbExists = await isDbCreated();
  if (!dbExists) {
    logMessage({ message: `DB doesn't exist, creating it`, level: "info" });
    await createDb();
  }

  logMessage({ message: `Setting up the DB`, level: "info" });
  return setUpDb();
};

setUp();
