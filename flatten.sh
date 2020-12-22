#!/usr/bin/env bash

if [ -d flats ]; then
  rm -rf flats
fi

mkdir -p flats/upgradeability

FLATTENER=./node_modules/.bin/truffle-flattener
BRIDGE_CONTRACTS_DIR=contracts/upgradeable_contracts
TOKEN_CONTRACTS_DIR=contracts/tokens

echo "Flattening common bridge contracts"
${FLATTENER} contracts/upgradeability/EternalStorageProxy.sol > flats/EternalStorageProxy_flat.sol

echo "Flattening contracts related to Omnibridge"
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge/HomeOmnibridge.sol > flats/HomeOmnibridge_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge/ForeignOmnibridge.sol > flats/ForeignOmnibridge_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge/modules/factory/TokenFactory.sol > flats/TokenFactory_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge/modules/factory/TokenProxy.sol > flats/TokenProxy_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge/modules/forwarding_rules/MultiTokenForwardingRulesManager.sol > flats/MultiTokenForwardingRulesManager_flat.sol

echo "Flattening contracts related to NFT Omnibridge"
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge_nft/HomeOmnibridgeNFT.sol > flats/HomeOmnibridgeNFT_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge_nft/ForeignOmnibridgeNFT.sol > flats/ForeignOmnibridgeNFT_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/omnibridge_nft/components/bridged/NFTProxy.sol > flats/NFTProxy_flat.sol

echo "Flattening token contracts"
${FLATTENER} ${TOKEN_CONTRACTS_DIR}/ERC721BridgeToken.sol > flats/ERC721BridgeToken_flat.sol
cp ./precompiled/PermittableToken_flat.sol flats

for file in flats/*.sol; do
  grep -v SPDX "$file" > tmp; mv tmp "$file"
done
