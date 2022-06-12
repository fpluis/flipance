/*
 * Attempts to retrieve the metadata for an NFT given the metadataURI defined
 * in its contract and its token id.
 */

import fetch from "node-fetch";
import resolveURI from "./resolve-uri.js";
import logMessage from "./log-message.js";

export default async (metadataURI = "", tokenId = "") => {
  if (metadataURI.startsWith(`data:application/json;base64,`)) {
    try {
      const base64String = metadataURI.replace(
        `data:application/json;base64,`,
        ""
      );
      const parsed = JSON.parse(Buffer.from(base64String, "base64"));
      if (parsed.image) {
        return parsed;
      }
    } catch (error) {
      logMessage(
        `Error parsing binary as JSON: ${JSON.stringify(error)}`,
        "warning"
      );
      return {};
    }
  }

  let url = resolveURI(metadataURI);
  if (/\{id\}/.test(url) && tokenId != null) {
    url = url.replace(`{id}`, tokenId);
  }

  return fetch(url).then(async (response) => {
    const contentTypeRaw = response.headers.get("content-type");
    const contentType = contentTypeRaw ? contentTypeRaw.toLowerCase() : "";
    if (contentType.startsWith("application/json")) {
      return response.json();
    }

    if (contentType.startsWith("text/plain")) {
      let metadata = {};
      try {
        metadata = await response.json();
      } catch (error) {
        const text = await response.text();
        logMessage(`Plain-text metadata URL is not JSON: ${text}`, "warning");
      }

      return metadata;
    }

    if (contentType.startsWith("text/html")) {
      const { status } = response;
      if (status !== 200) {
        return {};
      }

      return response.text().then(() => {
        return {};
      });
    }

    return {};
  });
};
