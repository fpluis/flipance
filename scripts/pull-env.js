/*
  This script will run during an EC2 instance initialization process.
  Its purpose is to pull the environment variables and save them
  to /etc/environment for later use by the bot.
*/
import { createWriteStream } from "fs";

const [
  ,
  ,
  parameterString,
  envPrefix = "/prod/",
  envPath = "/etc/environment",
] = process.argv;
console.log(`Param string '${parameterString}'`);
const { Parameters } = JSON.parse(parameterString);
console.log(`Parameters: ${JSON.stringify(Parameters)}`);
const stream = createWriteStream(envPath, { flags: "a" });
Parameters.forEach(({ Name, Value }) => {
  const name = Name.replace(envPrefix, "");
  stream.write(`${name}=${Value}\n`);
});
