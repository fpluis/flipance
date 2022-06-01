/*
 * Attempts to resolve a URI to a valid URL if it refers to
 a decentralized storage protocol like IPFS or Arweave.
 */

const resolveIPFSUri = (ipfsURI) =>
  `https://ipfs.io/ipfs/${ipfsURI.replace(/^ipfs:\/\//, "")}`;

const resolveArweaveURI = (arweaveURI) =>
  `https://ipfs.io/ipfs/${arweaveURI.replace(
    /^ar:\/\//,
    "https://arweave.net/"
  )}`;

export default (uri = "") =>
  uri.startsWith("ipfs://")
    ? resolveIPFSUri(uri)
    : uri.startsWith("ar://")
    ? resolveArweaveURI(uri)
    : uri;
