#!/bin/bash -xe

# This is the installation script that runs when an EC2 instance is deployed
# using the terraform.tf template at the project's root. It will set the env
# variables, install dependencies, pull the code and start the bot script
# using forever, so it will automatically reboot if the process exits.

# Redirect stdout and stderr to a log file for debugging.
exec 1>/home/ubuntu/startup.log 2>&1

sudo apt update -y
sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -

sudo apt install awscli nodejs postgresql postgresql-contrib -y
echo "Tools installed"

if [ ${REPO_IS_PUBLIC} ]; then
  git clone https://github.com/${GITHUB_REPO_IDENTIFIER}.git
else
  echo "No github token. Pulling assuming the repo is public"
  GITHUB_TOKEN=$(aws ssm get-parameter --region=us-east-1 --name ${GITHUB_TOKEN_PARAM} --with-decryption --query Parameter.Value | tr -d \")
  git clone https://$GITHUB_TOKEN@github.com/${GITHUB_REPO_IDENTIFIER}.git
fi

echo "Pulled the repo"

cd flipance
npm install
echo "Node dependencies installed"

aws ssm get-parameters-by-path --region=us-east-1 --with-decryption --path "/prod/" --output json > temp.env
sudo node --experimental-vm-modules scripts/pull-env.js
rm temp.env
echo "Env loaded"

echo "DB_HOSTNAME=${DB_HOSTNAME}" | sudo tee -a /etc/environment
echo "DB_PORT=${DB_PORT}" | sudo tee -a /etc/environment
echo "POSTGRES_USERNAME=${POSTGRES_USERNAME}" | sudo tee -a /etc/environment
echo "DB_NAME=${DB_NAME}" | sudo tee -a /etc/environment
echo "MAX_NICKNAME_LENGTH=${MAX_NICKNAME_LENGTH}" | sudo tee -a /etc/environment
echo "MAX_OFFER_FLOOR_DIFFERENCE=${MAX_OFFER_FLOOR_DIFFERENCE}" | sudo tee -a /etc/environment
echo "DEFAULT_USER_ALERT_LIMIT=${DEFAULT_USER_ALERT_LIMIT}" | sudo tee -a /etc/environment
echo "DEFAULT_SERVER_ALERT_LIMIT=${DEFAULT_SERVER_ALERT_LIMIT}" | sudo tee -a /etc/environment
echo "LOOKSRARE_RATE_LIMIT=${LOOKSRARE_RATE_LIMIT}" | sudo tee -a /etc/environment
echo "ETHEREUM_NETWORK=${ETHEREUM_NETWORK}" | sudo tee -a /etc/environment
echo "SHARD_ID=${SHARD_ID}" | sudo tee -a /etc/environment
echo "TOTAL_SHARDS=${TOTAL_SHARDS}" | sudo tee -a /etc/environment
echo "BACKUP_LOGS=${BACKUP_LOGS}" | sudo tee -a /etc/environment
echo "LOGGING_LEVELS=${LOGGING_LEVELS}" | sudo tee -a /etc/environment

source /etc/environment

# sudo -u postgres psql -U postgres -d postgres -c "create user $POSTGRES_USERNAME with password '$POSTGRES_PASSWORD'; alter user $POSTGRES_USERNAME with createdb"
# sudo -u postgres createdb flipanceadmin
sudo npm run setup-db
sudo npm run register-commands
echo "DB set up"

sudo npm install forever -g
echo "Forever installed"
sudo forever start scripts/crawler.js
sudo forever start scripts/bot-shard.js
echo "Process launched"