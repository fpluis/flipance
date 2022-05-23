#!/bin/bash -xe

# Redirect stdout and stderr to a log file for debugging.
exec 1>/home/ubuntu/startup.log 2>&1

sudo apt update -y
sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -

sudo apt install awscli curl nodejs postgresql postgresql-contrib -y
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
echo "DB_USERNAME=${DB_USERNAME}" | sudo tee -a /etc/environment
echo "DB_NAME=${DB_NAME}" | sudo tee -a /etc/environment
echo "MAX_NICKNAME_LENGTH=${MAX_NICKNAME_LENGTH}" | sudo tee -a /etc/environment
echo "MAX_OFFER_FLOOR_DIFFERENCE=${MAX_OFFER_FLOOR_DIFFERENCE}" | sudo tee -a /etc/environment

source /etc/environment

sudo -u postgres psql -U postgres -d postgres -c "create user $DB_USERNAME with password '$DB_PASSWORD'; alter user $DB_USERNAME with createdb"
sudo -u postgres npm run setup-db
echo "DB set up"

sudo npm install forever -g
echo "Forever installed"
sudo forever start scripts/start.js test
echo "Process launched"