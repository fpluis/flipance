/*
 * Logs messages that happen during the bot's execution to log files
for debugging. The logs are located at the logs folder in the project's
root. If the folder doesn't exist, this function creates it.
 */

import path from "path";
import dotenv from "dotenv";
import { existsSync, mkdirSync, createWriteStream } from "fs";

dotenv.config({ path: path.resolve(".env") });

const {
  LOGGING_LEVELS = "info,error",
  LOGGING_OUTPUT_FOLDER = "logs",
  BACKUP_LOGS = false,
} = process.env;

const loggingLevels = LOGGING_LEVELS.split(",");

if (BACKUP_LOGS && !existsSync(LOGGING_OUTPUT_FOLDER)) {
  mkdirSync(LOGGING_OUTPUT_FOLDER);
}

const levels = ["info", "warning", "error"];

const loggingStreams = BACKUP_LOGS
  ? levels.reduce((streams, level) => {
      streams[level] = createWriteStream(
        `${LOGGING_OUTPUT_FOLDER}/${level}.log`,
        {
          flags: "a",
        }
      );
      return streams;
    }, {})
  : {};

/**
 * Calls a LooksRare endpoint with a limited number of retries.
 * @typedef {"info"|"warning"|"error"} Level - The message's log level.
 * @param {String} message - The message to log.
 * @param {Level} level - The logging's level.
 * @param {Error} error - (optional) The thrown error object.
 * @return {Array} result - The result of the call.
 */
export default function logMessage({ level = "info", error, ...args }) {
  if (!loggingLevels.includes(level)) {
    return;
  }

  const logObject = {
    timestamp: new Date().toISOString(),
    ...args,
  };
  if (error) {
    logObject.error = error;
    logObject.errorString = error.toString();
    if (error.stack) {
      logObject.errorStack = error.stack;
    }
  }

  console.log(JSON.stringify(logObject));
  if (BACKUP_LOGS) {
    const stream = loggingStreams[level] || loggingStreams.info;
    stream.write(`${JSON.stringify(logObject)}\n`);
  }
}
