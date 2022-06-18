/*
A client that relies on 3rd party APIs to retrieve information
about NFT ownership
*/

import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import moralisClient from "moralis/node.js";
import logMessage from "../log-message.js";
import { createAlchemyWeb3 } from "@alch/alchemy-web3";

dotenv.config({ path: path.resolve(".env") });

const {
  NFT_SCAN_API_ID,
  NFT_SCAN_SECRET,
  MORALIS_SERVER_URL,
  MORALIS_APP_ID,
  MORALIS_MASTER_KEY,
  ALCHEMY_API_KEY,
  ETHEREUM_NETWORK,
} = process.env;

/* NFTScan requires a token to call its API. The purpose
of this cache is to reduce the number of calls to their
token endpoint and reuse the token as much as possible.
*/
const NFTScanTokenCache = {
  token: "",
  expiry: new Date("1970-01-01"),
};

// See https://developer.nftscan.com/doc/#section/Authentication
const getNFTScanToken = async () => {
  if (NFTScanTokenCache.expiry > new Date()) {
    return NFTScanTokenCache.token;
  }

  return fetch(
    `https://restapi.nftscan.com/gw/token?apiKey=${NFT_SCAN_API_ID}&apiSecret=${NFT_SCAN_SECRET}`
  )
    .then((res) => res.json())
    .then(async (response) => {
      if (response == null || response.data == null) {
        logMessage({
          message: `Empty NFTScan getToken response: ${response}`,
          level: "warning",
        });
        return null;
      }

      const {
        data: { accessToken, expiration },
      } = response;
      const newExpiry = new Date();
      newExpiry.setSeconds(newExpiry.getTime() + expiration * 1000);
      NFTScanTokenCache.expiry = newExpiry;
      NFTScanTokenCache.token = accessToken;
      return accessToken;
    })
    .catch((error) => {
      logMessage({
        message: `Error fetching NFTScan access token`,
        level: "warning",
        error,
      });
      return null;
    });
};

// See https://developer.nftscan.com/doc/#operation/getAllNftByUserAddressUsingPOST
const getNFTScanNFTs = async (address) => {
  const accessToken = await getNFTScanToken();
  if (accessToken == null) {
    return [];
  }

  return fetch(`https://restapi.nftscan.com/api/v1/getAllNftByUserAddress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Access-Token": accessToken,
    },
    body: JSON.stringify({
      erc: "erc721",
      page_index: 1,
      page_size: 100,
      user_address: address,
    }),
  })
    .then((res) => res.json())
    .then((response) => {
      if (response == null || response.data == null) {
        logMessage({
          message: `Empty NFTScan getNFTs response: ${response}`,
          level: "warning",
        });
        return [];
      }

      const {
        data: { content },
      } = response;
      return content.map(
        ({ nft_asset_id, nft_creator }) =>
          `${nft_creator}/${parseInt(nft_asset_id, 16)}`
      );
    })
    .catch((error) => {
      logMessage({
        message: `Error fetching NFTs from NFTScan`,
        level: "warning",
        error,
      });
      return [];
    });
};

export default async () => {
  let usingMoralis = true;
  await moralisClient
    .start({
      serverUrl: MORALIS_SERVER_URL,
      appId: MORALIS_APP_ID,
      masterKey: MORALIS_MASTER_KEY,
    })
    .catch(() => {
      logMessage({
        message: `Invalid/missing Moralis credentials. Starting without it`,
        level: "info",
      });
      usingMoralis = false;
    });

  const domain =
    ETHEREUM_NETWORK === "homestead"
      ? "https://eth-mainnet.alchemyapi.io"
      : "https://eth-rinkeby.alchemyapi.io";
  const alchemyClient = createAlchemyWeb3(
    `${domain}/nft/v2/${ALCHEMY_API_KEY}`
  );

  const getAlchemyNFTs = (address) =>
    alchemyClient.alchemy
      .getNfts({
        owner: address,
      })
      .then(({ ownedNfts }) => {
        return ownedNfts.map(
          ({ contract: { address }, id: { tokenId } }) =>
            `${address}/${parseInt(tokenId, 16)}`
        );
      })
      .catch(() => {
        return [];
      });

  /**
   * Get the NFTs owned by an ETH account
   * @param {String} address - The ETH address
   * @return {Array[String]} - The NFTs represented as "collection/tokenId"
   */
  const getAddressNFTs = (address = "") => {
    try {
      if (ETHEREUM_NETWORK === "rinkeby") {
        return getAlchemyNFTs(address);
      }

      return moralisClient.Web3API.account
        .getNFTs({
          address,
        })
        .then(({ result }) => {
          return result.map(
            ({ token_address, token_id }) => `${token_address}/${token_id}`
          );
        })
        .catch(() => {
          if (NFT_SCAN_API_ID && NFT_SCAN_SECRET) {
            return getNFTScanNFTs(address).catch(() => getAlchemyNFTs(address));
          }

          return getAlchemyNFTs(address);
        });
    } catch (error) {
      logMessage({
        mesage: `Error fetching NFTs for address ${address}`,
        level: "warning",
        error,
      });
      return [];
    }
  };

  const destroy = () => {
    return usingMoralis ? moralisClient.deactivateWeb3() : Promise.resolve();
  };

  return {
    getAddressNFTs,
    destroy,
  };
};
