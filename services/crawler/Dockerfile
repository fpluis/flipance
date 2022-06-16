# syntax=docker/dockerfile:1

FROM node:16

LABEL maintainer="Luis Fominaya (https://github.com/fpluis, @mrfominaya)" \
  description="Docker image for the [Flipance](https://github.com/fpluis/flipance) Discord bot"

WORKDIR /flipance-crawler

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

CMD node scripts/setup-db.js && \
  node scripts/register-commands.js && \
  node scripts/polling-node.js

# CMD node scripts/polling-node.js