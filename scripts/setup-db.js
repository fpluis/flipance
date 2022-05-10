/* eslint-disable no-multi-str */
import path from "path";
import dotenv from "dotenv";
import { createDb, setUpDb } from "../src/database/index.js";

dotenv.config({ path: path.resolve(".env") });

createDb().then(async () => {
  console.log(`DB created`);
  await setUpDb();
  console.log(`DB set up`);
});
