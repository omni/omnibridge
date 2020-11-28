const path = require('path')
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
})
const { isAddress, toBN } = require('web3').utils
const envalid = require('envalid')

const homePrefix = 'HOME'
const foreignPrefix = 'FOREIGN'

// Validations and constants
const validRewardModes = ['false', 'ONE_DIRECTION', 'BOTH_DIRECTIONS']
const bigNumValidator = envalid.makeValidator((x) => toBN(x))
const validateAddress = (address) => {
  if (isAddress(address)) {
    return address
  }

  throw new Error(`Invalid address: ${address}`)
}
const validateOptionalAddress = (address) => (address ? validateAddress(address) : '')
const addressValidator = envalid.makeValidator(validateAddress)
const optionalAddressValidator = envalid.makeValidator(validateOptionalAddress)
const addressesValidator = envalid.makeValidator((addresses) => {
  addresses.split(' ').forEach(validateAddress)
  return addresses
})

function checkLimits(min, max, daily, prefix) {
  if (min.isZero() || min.gte(max) || max.gte(daily)) {
    throw new Error(
      `Limit parameters should be defined as 0 < ${prefix}_MIN_AMOUNT_PER_TX < ${prefix}_MAX_AMOUNT_PER_TX < ${prefix}_DAILY_LIMIT`
    )
  }
}

const { BRIDGE_MODE, HOME_REWARDABLE, FOREIGN_REWARDABLE } = process.env

if (!validRewardModes.includes(HOME_REWARDABLE)) {
  throw new Error(`Invalid HOME_REWARDABLE: ${HOME_REWARDABLE}. Supported values are ${validRewardModes}`)
}

if (!validRewardModes.includes(FOREIGN_REWARDABLE)) {
  throw new Error(`Invalid FOREIGN_REWARDABLE: ${FOREIGN_REWARDABLE}. Supported values are ${validRewardModes}`)
}

// Types validations

let validations = {
  DEPLOYMENT_ACCOUNT_PRIVATE_KEY: envalid.str(),
  DEPLOYMENT_GAS_LIMIT_EXTRA: envalid.num(),
  HOME_DEPLOYMENT_GAS_PRICE: bigNumValidator(),
  FOREIGN_DEPLOYMENT_GAS_PRICE: bigNumValidator(),
  HOME_RPC_URL: envalid.str(),
  HOME_BRIDGE_OWNER: addressValidator(),
  HOME_UPGRADEABLE_ADMIN: addressValidator(),
  FOREIGN_RPC_URL: envalid.str(),
  FOREIGN_BRIDGE_OWNER: addressValidator(),
  FOREIGN_UPGRADEABLE_ADMIN: addressValidator(),
}

switch (BRIDGE_MODE) {
  case 'MULTI_AMB_ERC_TO_ERC':
    validations = {
      ...validations,
      HOME_AMB_BRIDGE: addressValidator(),
      FOREIGN_AMB_BRIDGE: addressValidator(),
      HOME_MEDIATOR_REQUEST_GAS_LIMIT: bigNumValidator(),
      FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT: bigNumValidator(),
      FOREIGN_MIN_AMOUNT_PER_TX: bigNumValidator(),
      FOREIGN_MAX_AMOUNT_PER_TX: bigNumValidator(),
      FOREIGN_DAILY_LIMIT: bigNumValidator(),
      HOME_MIN_AMOUNT_PER_TX: bigNumValidator(),
      HOME_MAX_AMOUNT_PER_TX: bigNumValidator(),
      HOME_DAILY_LIMIT: bigNumValidator(),
      HOME_ERC677_TOKEN_IMAGE: optionalAddressValidator(),
      HOME_TOKEN_FACTORY: optionalAddressValidator(),
      FOREIGN_ERC677_TOKEN_IMAGE: optionalAddressValidator(),
      FOREIGN_TOKEN_FACTORY: optionalAddressValidator(),
    }

    if (HOME_REWARDABLE === 'BOTH_DIRECTIONS') {
      validations = {
        ...validations,
        HOME_MEDIATOR_REWARD_ACCOUNTS: addressesValidator(),
        HOME_TRANSACTIONS_FEE: envalid.num(),
        FOREIGN_TRANSACTIONS_FEE: envalid.num(),
      }
    }
    break
  default:
    throw new Error(`Invalid BRIDGE_MODE=${BRIDGE_MODE}. Only MULTI_AMB_ERC_TO_ERC is supported.`)
}

const env = envalid.cleanEnv(process.env, validations)

checkLimits(env.HOME_MIN_AMOUNT_PER_TX, env.HOME_MAX_AMOUNT_PER_TX, env.HOME_DAILY_LIMIT, homePrefix)
checkLimits(env.FOREIGN_MIN_AMOUNT_PER_TX, env.FOREIGN_MAX_AMOUNT_PER_TX, env.FOREIGN_DAILY_LIMIT, foreignPrefix)
if (!env.HOME_TOKEN_FACTORY && !env.HOME_ERC677_TOKEN_IMAGE) {
  throw new Error('At least one of HOME_TOKEN_FACTORY and HOME_ERC677_TOKEN_IMAGE should be specified')
}
if (!env.FOREIGN_TOKEN_FACTORY && !env.FOREIGN_ERC677_TOKEN_IMAGE) {
  throw new Error('At least one of FOREIGN_TOKEN_FACTORY and FOREIGN_ERC677_TOKEN_IMAGE should be specified')
}

module.exports = env
