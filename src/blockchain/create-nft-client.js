/*
A client that relies on 3rd party APIs to retrieve information
about NFT ownership
*/

import path from "path";
import dotenv from "dotenv";
import fetch from "node-fetch";
import moralisClient from "moralis/node.js";

dotenv.config({ path: path.resolve(".env") });

const {
  NFT_SCAN_API_ID,
  NFT_SCAN_SECRET,
  MORALIS_SERVER_URL,
  MORALIS_APP_ID,
  MORALIS_MASTER_KEY,
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
    .then((result) => {
      const {
        data: { accessToken, expiration },
      } = result;
      const newExpiry = new Date();
      newExpiry.setSeconds(newExpiry.getTime() + expiration * 1000);
      NFTScanTokenCache.expiry = newExpiry;
      NFTScanTokenCache.token = accessToken;
      return accessToken;
    });
};

// See https://developer.nftscan.com/doc/#operation/getAllNftByUserAddressUsingPOST
const getNFTScanNFTs = async (address) => {
  const accessToken = await getNFTScanToken();
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
      const {
        data: { content },
      } = response;
      return content.map(
        ({ nft_asset_id, nft_creator }) =>
          `${nft_creator}/${parseInt(nft_asset_id, 16)}`
      );
    })
    .catch(() => {
      return [];
    });
};

export default async () => {
  await moralisClient
    .start({
      serverUrl: MORALIS_SERVER_URL,
      appId: MORALIS_APP_ID,
      masterKey: MORALIS_MASTER_KEY,
    })
    .catch(() => {
      console.log(`Invalid/missing Moralis credentials. Starting without it`);
    });

  /**
   * @param  {} address - The ETH address
   * @return {Array[String]} - The NFTs represented as "collection/tokenId"
   */
  const getAddressNFTs = (address) =>
    moralisClient.Web3API.account
      .getNFTs({
        address,
      })
      .then(({ result }) => {
        return result.map(
          ({ token_address, token_id }) => `${token_address}/${token_id}`
        );
      })
      .catch(() => getNFTScanNFTs(address));

  return {
    getAddressNFTs,
  };
};
