/*
  This script will create or replace the Flipance database with its schema.
  IMPORTANT: It will wipe the database if it exists, so only use it if you are
  absolutely sure.
*/

import path from "path";
import dotenv from "dotenv";
import {
  createDb,
  setUpDb,
  isDbCreated,
  removeDb,
} from "../src/database/index.js";

dotenv.config({ path: path.resolve(".env") });

const setUp = async () => {
  const dbExists = await isDbCreated();
  if (dbExists) {
    await removeDb();
  }

  await createDb();
  return setUpDb();
};

setUp();
