#!/usr/bin/env bash

if [ -d flats ]; then
  rm -rf flats
fi

mkdir -p flats/upgradeability

FLATTENER=./node_modules/.bin/truffle-flattener
BRIDGE_CONTRACTS_DIR=contracts/upgradeable_contracts

echo "Flattening common bridge contracts"
${FLATTENER} contracts/upgradeability/EternalStorageProxy.sol > flats/EternalStorageProxy_flat.sol

echo "Flattening contracts related to Omnibridge"
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/HomeOmnibridge.sol > flats/HomeOmnibridge_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/ForeignOmnibridge.sol > flats/ForeignOmnibridge_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/factory/TokenFactory.sol > flats/TokenFactory_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/factory/TokenProxy.sol > flats/TokenProxy_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/forwarding_rules/MultiTokenForwardingRulesManager.sol > flats/MultiTokenForwardingRulesManager_flat.sol

echo "Flattening token contracts"
cp ./precompiled/PermittableToken_flat.sol flats

for file in flats/*.sol; do
  grep -v SPDX "$file" > tmp; mv tmp "$file"
done
