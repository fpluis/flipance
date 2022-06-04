# syntax=docker/dockerfile:1

FROM node:16

LABEL maintainer="Luis Fominaya (https://github.com/fpluis, @mrfominaya)" \
      description="Docker image for the [Flipance](https://github.com/fpluis/flipance) Discord bot"

# Install dependencies
# RUN apt-get update -y
# RUN apt-get upgrade -y
# RUN apt-get install postgresql postgresql-contrib -y
# RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash -

WORKDIR /flipance

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

CMD node scripts/setup-db.js && \
    node scripts/start.js