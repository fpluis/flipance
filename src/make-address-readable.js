/* Turns a long hex string like "0x123456789123456" into "0x12...3456" */
export default (address) =>
  `${address.slice(0, 4)}...${address.slice(address.length - 4)}`;
