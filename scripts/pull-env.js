/*
  This script will run during an EC2 instance initialization process.
  Its purpose is to pull the environment variables and save them
  to /etc/environment for later use by the bot.
*/
import { readFileSync, createWriteStream } from "fs";

const [
  ,
  ,
  envFilePath = "temp.env",
  envPrefix = "/prod/",
  envPath = "/etc/environment",
] = process.argv;
const { Parameters } = JSON.parse(readFileSync(envFilePath).toString());
const stream = createWriteStream(envPath, { flags: "a" });
Parameters.forEach(({ Name, Value }) => {
  const name = Name.replace(envPrefix, "");
  stream.write(`${name}=${Value}\n`);
});
