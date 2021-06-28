FROM ethereum/solc:0.6.12 as build-deps

FROM node:14
COPY --from=build-deps /usr/bin/solc /usr/bin/solc

WORKDIR /aave

RUN git clone https://github.com/aave/protocol-v2 .

RUN npm i

RUN npm run compile

COPY hardhat.config.ts.mock hardhat.config.ts

ENV PROVIDER='http://ganache:8545'

ENTRYPOINT npx hardhat --network coverage aave:dev
