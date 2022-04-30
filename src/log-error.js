import { createWriteStream } from "fs";

const ERROR_OUTPUT_PATH = "errors.txt";

const errorStream = createWriteStream(ERROR_OUTPUT_PATH, { flags: "a" });

export default function logError(message) {
  errorStream.write(`${message}\n`);
}
