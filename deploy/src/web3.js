const Web3 = require('web3')
const env = require('./loadEnv')

const {
  HOME_RPC_URL,
  FOREIGN_RPC_URL,
  DEPLOYMENT_ACCOUNT_PRIVATE_KEY,
  HOME_EXPLORER_URL,
  FOREIGN_EXPLORER_URL,
  HOME_EXPLORER_API_KEY,
  FOREIGN_EXPLORER_API_KEY,
} = env

const homeProvider = new Web3.providers.HttpProvider(HOME_RPC_URL)
const web3Home = new Web3(homeProvider)

const foreignProvider = new Web3.providers.HttpProvider(FOREIGN_RPC_URL)
const web3Foreign = new Web3(foreignProvider)

const { HOME_DEPLOYMENT_GAS_PRICE, FOREIGN_DEPLOYMENT_GAS_PRICE } = env
const GAS_LIMIT_EXTRA = env.DEPLOYMENT_GAS_LIMIT_EXTRA

const deploymentAddress = web3Home.eth.accounts.privateKeyToAccount(DEPLOYMENT_ACCOUNT_PRIVATE_KEY).address

module.exports = {
  web3Home,
  web3Foreign,
  deploymentAddress,
  HOME_RPC_URL,
  FOREIGN_RPC_URL,
  GAS_LIMIT_EXTRA,
  HOME_DEPLOYMENT_GAS_PRICE,
  FOREIGN_DEPLOYMENT_GAS_PRICE,
  HOME_EXPLORER_URL,
  FOREIGN_EXPLORER_URL,
  HOME_EXPLORER_API_KEY,
  FOREIGN_EXPLORER_API_KEY,
  DEPLOYMENT_ACCOUNT_PRIVATE_KEY,
}
