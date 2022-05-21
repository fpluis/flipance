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
