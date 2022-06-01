/*
 * Logs errors that happen during the bot's execution to a log file
for debugging. The logs are located at the logs folder in the project's
root. If the folder doesn't exist, this function creates it.
 */

import { existsSync, mkdirSync, createWriteStream } from "fs";

const ERROR_OUTPUT_FOLDER = "logs";
const ERROR_OUTPUT_PATH = `${ERROR_OUTPUT_FOLDER}/errors.txt`;

if (!existsSync(ERROR_OUTPUT_FOLDER)) {
  mkdirSync(ERROR_OUTPUT_FOLDER);
}

const errorStream = createWriteStream(ERROR_OUTPUT_PATH, { flags: "a" });

export default function logError(message) {
  errorStream.write(`${message}\n`);
}
