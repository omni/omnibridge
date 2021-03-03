# How to Deploy POA Bridge Contracts

In order to deploy bridge contracts you must run `yarn` to install all dependencies. For more information, see the [project README](../README.md).

1. Compile the source contracts.
```
cd ..
yarn compile
```

2. Create a `.env` file.
```
cd deploy
cp .env.example .env
```

3. If necessary, deploy and configure a multi-sig wallet contract to manage the bridge contracts after deployment. We have not audited any wallets for security, but have used https://github.com/gnosis/MultiSigWallet/ with success.

4. Adjust the parameters in the `.env` file depending on the desired bridge mode. See below for comments related to each parameter.

5. Add funds to the deployment accounts in both the Home and Foreign networks.

6. Run `npm run deploy`.

## `OMNIBRIDGE` Bridge Mode Configuration Example.

This example of an `.env` file for the `OMNIBRIDGE` bridge mode includes comments describing each parameter.

```bash
# The type of bridge. Defines set of contracts to be deployed.
BRIDGE_MODE=OMNIBRIDGE

# The private key hex value of the account responsible for contracts
# deployments and initial configuration. The account's balance must contain
# funds from both networks.
DEPLOYMENT_ACCOUNT_PRIVATE_KEY=67..14
# Extra gas added to the estimated gas of a particular deployment/configuration transaction
# E.g. if estimated gas returns 100000 and the parameter is 0.2,
# the transaction gas limit will be (100000 + 100000 * 0.2) = 120000
DEPLOYMENT_GAS_LIMIT_EXTRA=0.2
# The "gasPrice" parameter set in every deployment/configuration transaction on
# Home network (in Wei).
HOME_DEPLOYMENT_GAS_PRICE=10000000000
# The "gasPrice" parameter set in every deployment/configuration transaction on
# Foreign network (in Wei).
FOREIGN_DEPLOYMENT_GAS_PRICE=10000000000

# The RPC channel to a Home node able to handle deployment/configuration
# transactions.
HOME_RPC_URL=https://core.poa.network
# Address on Home network with permissions to change parameters of the bridge contract.
# For extra security we recommended using a multi-sig wallet contract address here.
HOME_BRIDGE_OWNER=0x
# Address on Home network with permissions to upgrade the bridge contract
HOME_UPGRADEABLE_ADMIN=0x
# The default daily transaction limit in Wei. As soon as this limit is exceeded, any
# transaction which requests to relay assets will fail.
HOME_DAILY_LIMIT=30000000000000000000000000
# The default maximum limit for one transaction in Wei. If a single transaction tries to
# relay funds exceeding this limit it will fail. HOME_MAX_AMOUNT_PER_TX must be
# less than HOME_DAILY_LIMIT.
HOME_MAX_AMOUNT_PER_TX=1500000000000000000000000
# The default minimum limit for one transaction in Wei. If a transaction tries to relay
# funds below this limit it will fail. This is required to prevent dryout
# validator accounts.
HOME_MIN_AMOUNT_PER_TX=500000000000000000

# The RPC channel to a Foreign node able to handle deployment/configuration
# transactions.
FOREIGN_RPC_URL=https://mainnet.infura.io
# Address on Foreign network with permissions to change parameters of the bridge contract.
# For extra security we recommended using a multi-sig wallet contract address here.
FOREIGN_BRIDGE_OWNER=0x
# Address on Foreign network with permissions to upgrade the bridge contract and the
# bridge validator contract.
FOREIGN_UPGRADEABLE_ADMIN=0x
# The default daily limit in Wei. As soon as this limit is exceeded, any transaction
# requesting to relay assets will fail.
FOREIGN_DAILY_LIMIT=15000000000000000000000000
# The default maximum limit per one transaction in Wei. If a transaction tries to relay
# funds exceeding this limit it will fail. FOREIGN_MAX_AMOUNT_PER_TX must be less
# than FOREIGN_DAILY_LIMIT.
FOREIGN_MAX_AMOUNT_PER_TX=750000000000000000000000
# The default minimum limit for one transaction in Wei. If a transaction tries to relay
# funds below this limit it will fail.
FOREIGN_MIN_AMOUNT_PER_TX=500000000000000000

# The address of the existing AMB bridge in the Home network that will be used to pass messages
# to the Foreign network.
HOME_AMB_BRIDGE=0x
# The address of the existing AMB bridge in the Foreign network that will be used to pass messages
# to the Home network.
FOREIGN_AMB_BRIDGE=0x
# The gas limit that will be used in the execution of the message passed to the mediator contract
# in the Foreign network.
HOME_MEDIATOR_REQUEST_GAS_LIMIT=2000000
# The gas limit that will be used in the execution of the message passed to the mediator contract
# in the Home network.
FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT=2000000

# Variable to define whether to collect fee on bridge transfers
# On this bridge mode only BOTH_DIRECTIONS is supported, leave false to disable fees collection
HOME_REWARDABLE=false
# On this this bridge mode, fees collection on home side is not supported, should be false.
FOREIGN_REWARDABLE=false

# Fee to be taken for every transaction directed from the Home network to the Foreign network
# Makes sense only when HOME_REWARDABLE=BOTH_DIRECTIONS
# e.g. 0.1% fee
HOME_TRANSACTIONS_FEE=0.001
# Fee to be taken for every transaction directed from the Foreign network to the Home network
# Makes sense only when HOME_REWARDABLE=BOTH_DIRECTIONS
# e.g. 0.1% fee
FOREIGN_TRANSACTIONS_FEE=0.001

# List of accounts where rewards should be transferred in Home network separated by space without quotes
# Makes sense only when HOME_REWARDABLE=BOTH_DIRECTIONS
#E.g. HOME_MEDIATOR_REWARD_ACCOUNTS=0x 0x 0x
HOME_MEDIATOR_REWARD_ACCOUNTS=0x

# address of an already deployed PermittableToken contract that will be used as an implementation for all bridged tokens on the Home side
# leave empty, if you want to deploy a new PermittableToken for further usage
HOME_ERC677_TOKEN_IMAGE=
# address of an already deployed TokenFactory contract for creating new bridged tokens on the Home side.
# leave empty, if you want to deploy a new TokenFactory
HOME_TOKEN_FACTORY=
# address of an already deployed MultiTokenForwardingRulesManager contract for managing AMB lane permissions.
# leave empty, if you want to deploy a new MultiTokenForwardingRulesManager.
# put false, if you want to do not use lane permissions.
HOME_FORWARDING_RULES_MANAGER=

# address of an already deployed PermittableToken contract that will be used as an implementation for all bridged tokens on the Foreign side
# leave empty, if you want to deploy a new PermittableToken for further usage
FOREIGN_ERC677_TOKEN_IMAGE=
# address of an already deployed TokenFactory contract for creating new bridged tokens on the Foreign side.
# leave empty, if you want to deploy a new TokenFactory
FOREIGN_TOKEN_FACTORY=

# suffix used for token names for tokens bridged from Foreign to Home
# usually you might want it to start with a space character
HOME_TOKEN_NAME_SUFFIX=""

# suffix used for token names for tokens bridged from Home to Foreign
# usually you might want it to start with a space character
FOREIGN_TOKEN_NAME_SUFFIX=""

# The api url of an explorer to verify all the deployed contracts in Home network. Supported explorers: Blockscout, etherscan
#HOME_EXPLORER_URL=https://blockscout.com/poa/core/api
# The api key of the explorer api, if required, used to verify all the deployed contracts in Home network.
#HOME_EXPLORER_API_KEY=
# The api url of an explorer to verify all the deployed contracts in Foreign network. Supported explorers: Blockscout, etherscan
#FOREIGN_EXPLORER_URL=https://api.etherscan.io/api
# The api key of the explorer api, if required, used to verify all the deployed contracts in Foreign network.
#FOREIGN_EXPLORER_API_KEY=
```
