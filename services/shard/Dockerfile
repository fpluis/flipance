# syntax=docker/dockerfile:1

FROM node:16

LABEL maintainer="Luis Fominaya (https://github.com/fpluis, @mrfominaya)" \
  description="Docker image for the [Flipance](https://github.com/fpluis/flipance) Discord bot"

WORKDIR /flipance-shard

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

CMD node scripts/bot-shard.js