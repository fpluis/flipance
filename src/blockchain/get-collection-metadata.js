import { readFileSync } from "fs";
import path from "path";
import dotenv from "dotenv";
import { ethers, getDefaultProvider } from "ethers";

dotenv.config({ path: path.resolve(".env") });

const erc721Abi = JSON.parse(readFileSync("data/erc721Abi.json"));

const {
  ETHERSCAN_API_KEY,
  INFURA_PROJECT_ID,
  POCKET_PROJECT_ID,
  POCKET_SECRET_KEY,
  ALCHEMY_API_KEY,
} = process.env;

const ethProvider = getDefaultProvider("homestead", {
  etherscan: ETHERSCAN_API_KEY,
  infura: INFURA_PROJECT_ID,
  pocket: {
    applicationId: POCKET_PROJECT_ID,
    applicationSecretKey: POCKET_SECRET_KEY,
  },
  alchemy: ALCHEMY_API_KEY,
});

/**
 * Get the metadata associated to an NFT collection. Currently only ERC-721
 * collections are supported.
 * @param  {String} collection - The ETH address
 * @return {Object} metadata - The metadata object as { name: String }.
 */
export default (collection = "") => {
  const tokenContract = new ethers.Contract(collection, erc721Abi, ethProvider);
  return Promise.all([
    tokenContract.name().catch(() => {
      return null;
    }),
  ]).then(([name]) => ({ name }));
};
