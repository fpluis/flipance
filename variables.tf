variable "AWS_REGION" {
  type        = string
  description = "AWS region where the infrastructure will be deployed"
  default     = "us-east-1"
}

variable "EC2_INSTANCE_TYPE" {
  type        = string
  description = "The instance type for the server that will host the bot. You can find the pricing details here https://aws.amazon.com/ec2/pricing/on-demand/"
  default     = "t3.micro"
}

variable "ETHERSCAN_API_KEY" {
  type        = string
  description = "Etherscan API key needed to fetch Ethereum events from the blockchain"
  sensitive   = true
}

variable "INFURA_PROJECT_ID" {
  type        = string
  description = "Infura project id. You can find it at https://infura.io/dashboard > click on your project > click on project settings (top left)"
  sensitive   = true
  default     = ""
}

variable "POCKET_PROJECT_ID" {
  type        = string
  description = "Pocket project id. You can find it at https://mainnet.portal.pokt.network/#/home > click on Apps (on the left) > click on your project > Portal ID (on the right)"
  sensitive   = true
  default     = ""
}

variable "POCKET_SECRET_KEY" {
  type        = string
  description = "Pocket project secret key. You can find it at https://mainnet.portal.pokt.network/#/home > click on Apps (on the left) > click on your project > Secret Key (on the right)"
  sensitive   = true
  default     = ""
}

variable "ALCHEMY_API_KEY" {
  type        = string
  description = "Alchemy API Key. You can see it by logging in to https://dashboard.alchemyapi.io/ > click on 'View Key' under your App > API KEY"
  sensitive   = true
}

variable "DISCORD_CLIENT_ID" {
  type        = string
  description = "Discord application ID. You can find it under https://discord.com/developers/applications > click on your application > APPLICATION ID"
  sensitive   = true
}

variable "DISCORD_BOT_TOKEN" {
  type        = string
  description = "Discord Bot token. You can find it under https://discord.com/developers/applications > click on your application > Bot (on the left) > Token. If you don't have one yet, you'll have to click on 'Reset Token' to get one."
  sensitive   = true
}

variable "DISCORD_CLIENT_ID_TEST" {
  type        = string
  description = "Discord application ID used to test the bot (Optional)"
  sensitive   = true
  default     = ""
}

variable "DISCORD_BOT_TOKEN_TEST" {
  type        = string
  description = "Discord Bot token used to test the bot (Optional)"
  sensitive   = true
  default     = ""
}

variable "MORALIS_SERVER_URL" {
  type        = string
  description = "URL of the Moralis server you create for this application. You can see your servers and create a new one at https://admin.moralis.io/servers. Click on 'View Details' to launch a modal with the Server URL"
  default     = ""
}

variable "MORALIS_APP_ID" {
  type        = string
  description = "URL of the Moralis server you create for this application. You can see your servers and create a new one at https://admin.moralis.io/servers. Click on 'View Details' to launch a modal with the Application ID"
  sensitive   = true
  default     = ""
}

variable "MORALIS_MASTER_KEY" {
  type        = string
  description = "URL of the Moralis server you create for this application. You can see your servers and create a new one at https://admin.moralis.io/servers. Click on 'View Details' to launch a modal with the Master Key"
  sensitive   = true
  default     = ""
}

variable "NFT_SCAN_API_ID" {
  type        = string
  description = "NFTScan API ID you can find at https://developer.nftscan.com/assist."
  sensitive   = true
  default     = ""
}

variable "NFT_SCAN_SECRET" {
  type        = string
  description = "NFTScan SECRET you can find at https://developer.nftscan.com/assist."
  sensitive   = true
  default     = ""
}

variable "GITHUB_TOKEN" {
  type        = string
  description = "Temporary Github access token used to pull the repository if it is private"
  sensitive   = true
  default     = ""
}

variable "LOOKSRARE_API_KEY" {
  type        = string
  description = "LooksRare API key that grants you a higher rate limit. See https://docs.looksrare.org/developers/public-api-documentation for more information."
  sensitive   = true
}

variable "LOOKSRARE_RATE_LIMIT" {
  type        = number
  description = "Rate limit of your LooksRare API key, if you have one. See https://docs.looksrare.org/developers/public-api-documentation for more information."
  default   = 120
}

variable "GITHUB_REPO_IDENTIFIER" {
  type = string
  description = "The Github username and repo name for the bot. Example: 'fpluis/flipance' is the identifier for the original repo."
  default = "fpluis/flipance"
}

# variable "DB_HOSTNAME" {
#   type        = string
#   description = "Http host for the PostgreSQL database."
#   default     = "localhost"
# }

variable "DB_PORT" {
  type        = string
  description = "Port for the PostgreSQL database."
  default     = "5432"
}

variable "POSTGRES_USERNAME" {
  type        = string
  description = "Username for the PostgreSQL database."
  default     = "user"
}

variable "POSTGRES_PASSWORD" {
  type        = string
  description = "Password for the PostgreSQL database."
  sensitive   = true
}

variable "DB_NAME" {
  type        = string
  description = "PostgreSQL database name."
  default     = "flipance"
}

variable "MAX_NICKNAME_LENGTH" {
  type        = string
  description = "Max. length in characters that alert nicknames can have."
  default     = 50
}

variable "MAX_OFFER_FLOOR_DIFFERENCE" {
  type        = string
  description = "Default max. difference as a percentage between the floor and the offer for all alerts. Example: if you set this variable at 15, alerts by default will only notify if an offer is 85% or more of the current floor for the collection."
  default     = 15
}

variable "DEFAULT_USER_ALERT_LIMIT" {
  type        = string
  description = "Default max number of alerts a user can have. Each user in the database has a personal limit, so it can be changed for a specific user by querying the database."
  default     = 3
}

variable "DEFAULT_SERVER_ALERT_LIMIT" {
  type        = string
  description = "Default max number of alerts a server can have. Each server in the database has its own limit, and it can be changed for a specific server by querying the database."
  default     = 1
}

variable "ETHEREUM_NETWORK" {
  type        = string
  description = "What Ethereum network you want to use. You can set this variable to 'rinkeby' if you want to test the bot."
  default     = "homestead"
}

variable "SHARD_ID" {
  type        = number
  description = "The id of the shard currently running. If you need to run multiple shards, you can do so in the same environment but you will have to start the individual process using 'export SHARD_ID=1&&npm run bot-shard' on Linux or 'set SHARD_ID=1&&npm run bot-shard' on Windows. For more information on sharding, go to https://discordjs.guide/sharding/#when-to-shard"
  default     = 0
}

variable "TOTAL_SHARDS" {
  type        = number
  description = "Number of Discord shards the bot is running. For more information on sharding, go to https://discordjs.guide/sharding/#when-to-shard"
  default     = 1
}

variable "BACKUP_LOGS" {
  type        = bool
  description = "Whether to backup logs to the /logs folder, organized by log level"
  default     = true
}

variable "LOGGING_LEVELS" {
  type        = string
  description = "Logging levels to display on both the processes and (if chosen), logged to file"
  default     = "info,error"
}
