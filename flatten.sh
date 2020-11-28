#!/usr/bin/env bash

if [ -d flats ]; then
  rm -rf flats
fi

mkdir -p flats/upgradeability
mkdir -p flats/multi_amb_erc20_to_erc677

FLATTENER=./node_modules/.bin/truffle-flattener
BRIDGE_CONTRACTS_DIR=contracts/upgradeable_contracts
VALIDATOR_CONTRACTS_DIR=contracts/upgradeable_contracts

echo "Flattening common bridge contracts"
${FLATTENER} contracts/upgradeability/EternalStorageProxy.sol > flats/upgradeability/EternalStorageProxy_flat.sol

echo "Flattening contracts related to multi-erc-to-erc on top of AMB bridge"
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/multi_amb_erc20_to_erc677/HomeMultiAMBErc20ToErc677.sol > flats/multi_amb_erc20_to_erc677/HomeMultiAMBErc20ToErc677_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/multi_amb_erc20_to_erc677/ForeignMultiAMBErc20ToErc677.sol > flats/multi_amb_erc20_to_erc677/ForeignMultiAMBErc20ToErc677_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/multi_amb_erc20_to_erc677/modules/factory/TokenFactory.sol > flats/multi_amb_erc20_to_erc677/TokenFactory_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/multi_amb_erc20_to_erc677/modules/factory/TokenProxy.sol > flats/multi_amb_erc20_to_erc677/TokenProxy_flat.sol
${FLATTENER} ${BRIDGE_CONTRACTS_DIR}/multi_amb_erc20_to_erc677/modules/forwarding_rules/MultiTokenForwardingRulesManager.sol > flats/multi_amb_erc20_to_erc677/MultiTokenForwardingRulesManager_flat.sol

for file in flats/*/*.sol; do
  grep -v SPDX "$file" > tmp; mv tmp "$file"
done
