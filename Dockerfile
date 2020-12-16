FROM node:14 as contracts

WORKDIR /contracts

COPY package.json yarn.lock ./
RUN yarn

COPY truffle-config.js truffle-config.js
COPY ./precompiled ./precompiled
COPY ./contracts ./contracts
RUN yarn compile

COPY flatten.sh flatten.sh
RUN yarn flatten

FROM node:14

WORKDIR /contracts

COPY package.json yarn.lock ./
RUN yarn install --prod

COPY --from=contracts /contracts/build ./build
COPY --from=contracts /contracts/flats ./flats
COPY ./precompiled/PermittableToken.json ./precompiled/PermittableToken.json

COPY deploy.sh deploy.sh
COPY ./deploy ./deploy

ENV PATH="/contracts/:${PATH}"
