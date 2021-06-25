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
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/fee_manager/OmnibridgeFeeManager.sol > flats/OmnibridgeFeeManager_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/gas_limit/SelectorTokenGasLimitManager.sol > flats/SelectorTokenGasLimitManager_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/interest/CompoundInterestERC20.sol > flats/CompoundInterestERC20_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/modules/interest/AAVEInterestERC20.sol > flats/AAVEInterestERC20_flat.sol

echo "Flattening token contracts"
cp ./precompiled/PermittableToken_flat.sol flats

for file in flats/*.sol; do
  grep -v SPDX "$file" > tmp; mv tmp "$file"
done
