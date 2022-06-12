/* eslint-disable max-len */
/*
 * Logs messages that happen during the bot's execution to log files
for debugging. The logs are located at the logs folder in the project's
root. If the folder doesn't exist, this function creates it.
 */

import { existsSync, mkdirSync, createWriteStream } from "fs";

const LOGGING_OUTPUT_FOLDER = "logs";

if (!existsSync(LOGGING_OUTPUT_FOLDER)) {
  mkdirSync(LOGGING_OUTPUT_FOLDER);
}

const levels = ["info", "debug", "warning", "error", "other"];
const loggingStreams = levels.reduce((streams, level) => {
  streams[level] = createWriteStream(`${LOGGING_OUTPUT_FOLDER}/${level}.log`, {
    flags: "a",
  });
  return streams;
}, {});

/**
 * Calls a LooksRare endpoint with a limited number of retries.
 * @typedef {"info"|"debug"|"warning"|"error"|"other"} Level - The message's log level.
 * @param {String} message - The message to log.
 * @param {Level} level - The logging's level.
 * @param {Error} error - (optional) The thrown error object.
 * @return {Array} result - The result of the call.
 */
export default function logMessage(message, level, error) {
  const stream = loggingStreams[level] || loggingStreams.other;
  stream.write(
    `${new Date().toISOString()}: ${message}${
      error ? `Stack trace: ${error.stack}` : ""
    }\n`
  );
}
