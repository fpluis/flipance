// This file contains the type definitions shared across the different modules

// eslint-disable-next-line no-unused-vars
// import { BigNumber } from "ethers";

/**
 * @typedef {("rarible"|"foundation"|"x2y2"|"openSea"|"looksRare")} Marketplace - The list of ids can be found in data/marketplaces.json.
 */

/**
 * @typedef {("offer"|"placeBid"|"acceptOffer"|"acceptAsk"|"cancelOrder"|"createAuction"|"settleAuction")} EventType - The list of ids can be found
 * in data/nft-events.json.
 */

/**
 * @typedef {"listing"|"offer"} OrderType - The type of marketplace order
 */

/**
 * @typedef {"ethereum"} Blockchain - The blockchain where the event took place
 */

/**
 * @typedef {"ERC-721"|"ERC-1155"} Standard - The NFT standard
 */

/**
 * @typedef {"wallet"|"server"|"collection"} AlertType - The type of alert
 */

/**
 * @typedef {"LIST|OFFER|CANCEL_lIST|CANCEL_OFFER"} LREventType - The type of LooksRare event. Note that not all events are included here because on-chain events are fetched directly from the blockchain.
 */

/**
 * @typedef {Object} Settings - The alert/user settings object used
 * to filter events depending on type, marketplace, price, etc.
 * @property {Number} id - The settings's id in the database.
 * @property {Number} maxOfferFloorDifference - The max difference an offer
 * can have with respect to the collection's floor to notify the user/server.
 * @property {Marketplace[]} allowedMarketplaces - The list of marketplaces
 * which the user/alert wants to watch.
 * @property {EventType[]} allowedEvents - The list of NFT event types
 * which the user/alert wants to watch.
 */

/**
 * @typedef {Object} User - The user information.
 * @property {Number} id - The user's id in the database.
 * @property {Number} maxOfferFloorDifference - The max difference an offer
 * can have with respect to the collection's floor to notify the user/server.
 * @property {Marketplace[]} allowedMarketplaces - The list of marketplaces
 * which the user wants to watch.
 * @property {EventType[]} allowedEvents - The list of NFT event types
 * which the user wants to watch.
 * @property {Number} settingsId - The user's settings id in the database.
 * @property {String} discordId - The user's discord id.
 * @property {Date} createdAt - The Date when the user was created.
 * @property {Number} alertLimit - The max. number of alerts that the user can have.
 */

/**
 * @typedef {Object} Alert - The alert information, including its settings.
 * @property {Number} maxOfferFloorDifference - The max difference an offer
 * can have with respect to the collection's floor to create a notification.
 * @property {Marketplace[]} allowedMarketplaces - The list of marketplaces which the alert wants to watch.
 * @property {EventType[]} allowedEvents - The list of NFT event types which the alert wants to watch.
 * @property {Number} id - The alert's id in the database.
 * @property {AlertType} type - The alert's type.
 * @property {Number} settingsId - The user's settings id in the database.
 * @property {String} userId - The id of this alert's creator.
 * @property {String} address - The Ethereum address that the alert watches.
 * @property {String|null} nickname - The alert's nickname.
 * @property {Date} createdAt - The Date when the alert was created.
 * @property {Date} syncedAt - The Date when the alert's tokens were last modified.
 * @property {String|null} channelId - The id of the Discord channel for which this alert was created.
 * @property {String[]} tokens - The tokens that the alert tracks. They are periodically updated. The "syncedAt" property shows when they were updated last. The format for the tokens is "collection/tokenId".
 */

/**
 * @typedef {Object} Offer - The offer information.
 * @property {String} collection - The collection's Ethereum address.
 * @property {String} tokenId - The id of the token for which the offer was
 * made. If it's a collection offer, it will will be and empty string.
 * @property {Date} createdAt - The Date when the offer was made in that marketplace.
 * @property {Date} endsAt - The Date when the offer expires.
 * @property {Marketplace} marketplace - The id of the marketplace where this offer was made.
 * @property {String} orderHash - The hash of the offer order on that marketplace.
 * @property {Number} price - The offer's price in Ethereum.
 */

/**
 * @typedef {Object} CollectionFloor - The floor information.
 * @property {String} collection - The collection's Ethereum address.
 * @property {Date} createdAt - The Date when the floor price was detected.
 * Will be different from the time when the floor listing was made.
 * @property {Marketplace} marketplace - The id of the marketplace where this floor was detected.
 * @property {String} orderHash - The hash of the listing order on that marketplace.
 * @property {Number} price - The floor's price in Ethereum.
 */

/**
 * @typedef {Object} NFTEvent - The NFT Event object.
 * @property {Number} id - The event's id in the database.
 * @property {String|null} transactionHash - The transaction hash in the blockchain.
 * @property {String|null} orderHash - The order hash in the marketplace where it originated.
 * @property {Date} createdAt - The Date when the event was added to the database.
 * @property {Date|null} startsAt - The Date when the event happened.
 * @property {Date|null} endsAt - The Date when the event stops.
 * @property {String|null} tokenId - The id of the token involved in the event. If it's a collection event (i.e. collection offer) or an event without token id (i.e. cancel order), it will will be an empty string.
 * @property {EventType|null} eventType - The type of event. See data/nft-events.json for the complete list.
 * @property {Blockchain|null} blockchain - The blockchain's id
 * @property {Marketplace|null} marketplace - The id of the marketplace where this floor was detected.
 * @property {String|null} collection - The collection's address.
 * @property {String|null} initiator - The address of the tx's initiator.
 * @property {String|null} buyer - The address that buys the NFT.
 * @property {String|null} seller - The address that sells the NFT.
 * @property {String|null} intermediary - The blockchain address of the intermediary in the transaction, if any. Example: gem.xyz's address.
 * @property {Number|null} gas - The gas consumed by the tx.
 * @property {Number|null} amount - The number of NFTs transferred.
 * @property {String|null} metadataUri - The metadata URI associated to the NFT.
 * @property {Standard|null} standard - The metadata URI associated to the NFT.
 * @property {OrderType|null} orderType - For cancelOrder events, the order type.
 * @property {Boolean|null} isHighestOffer - For offers, whether the offer is the highest offer at the time.
 * @property {Number|null} collectionFloor - For offers and listings, the collection's floor at the time the order is made.
 * @property {Number|null} floorDifference - For an offer and listing, its difference wrt the current floor as a percentage between 0 and 1. I.e. if the floor is 1 ETH and the offer is 0.8 ETH, the floorDifference = 0.2. Also accepts negative values: if the floor is 1 ETH and the listing is 4 ETH, the floorDifference = (1 - 4 / 1) = -3.
 * @property {Number|null} price - The price in the blockchain's native token. If it's an offer, the offer price; if it's a sale, the sale price.
 */

/**
 * @typedef {NFTEvent} WatchedNFTEvent
 * @property {Alert[]} watchers
 */

/**
 * @typedef {Object} LROrder - A [LooksRare order object](https://docs.looksrare.org/developers/maker-orders).
 * @property {Boolean} isOrderAsk - Whether the order is an ask or a take order.
 * @property {String} signer - The address that signed the order.
 * @property {String} collection - The collection's address.
 * @property {String|null} tokenId - The id of the token. Null for collection offers.
 * @property {Number} amount - The number of tokens. Only relevant for ERC-1155 tokens.
 * @property {BigNumber} price - The order's price.
 * @property {Number} startTime - Order start date expressed as seconds since the epoch. It can be a future date.
 * @property {Number} endTime - Order expiry date expressed as seconds since the epoch.
 * @property {"VALID"|"CANCELLED"|"EXECUTED"|"EXPIRED"} status - The order's status.
 */

/**
 * @typedef {Object} LRToken - A LooksRare token object with its metadata and on-chain information.
 * @property {String} tokenId - The token's id.
 * @property {String} tokenURI - The token's metadata URI.
 */

/**
 * @typedef {Object} LREvent - A LooksRare NFT Event object, retrieved from the [events endpoint](https://looksrare.github.io/api-docs/#/Events/EventController.getEvents).
 * @property {Number} id - The event's id in LooksRare's database.
 * @property {String} from - The address that generates the event.
 * @property {String|null} to - The address that receives the event.
 * @property {LREventType} type - LooksRare's event type.
 * @property {String} hash - The transaction's hash where this event happened.
 * @property {Number|null} amount - The number of NFTs transferred.
 * @property {Date} createdAt - The Date when the event happened.
 * @property {Standard|null} standard - The metadata URI associated to the NFT.
 * @property {OrderType|null} orderType - For cancelOrder events, the order type.
 * @property {Boolean|null} isHighestOffer - For offers, whether the offer is the highest offer at the time.
 * @property {Number|null} collectionFloor - For offers and listings, the collection's floor at the time the order is made.
 * @property {Number|null} floorDifference - For an offer and listing, its difference wrt the current floor as a percentage between 0 and 1. I.e. if the floor is 1 ETH and the offer is 0.8 ETH, the floorDifference = 0.2. Also accepts negative values: if the floor is 1 ETH and the listing is 4 ETH, the floorDifference = (1 - 4 / 1) = -3.
 * @property {Number|null} price - The price in the blockchain's native token. If it's an offer, the offer price; if it's a sale, the sale price.
 * @property {LROrder} order - The LooksRare order object.
 * @property {LRToken} token - The LooksRare token information.
 */
