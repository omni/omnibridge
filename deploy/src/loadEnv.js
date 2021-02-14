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
const validateAddress = (address) => {
  if (isAddress(address)) {
    return address
  }

  throw new Error(`Invalid address: ${address}`)
}
const validateOptionalAddress = (address) => (address && address !== '0x' ? validateAddress(address) : '')
const addressValidator = envalid.makeValidator(validateAddress)
const optionalAddressValidator = envalid.makeValidator(validateOptionalAddress)
const addressesValidator = envalid.makeValidator((addresses) => addresses.split(' ').map(validateAddress))
const percentageValidator = envalid.makeValidator((value) => {
  if (!value || value === '0') {
    return '0'
  }
  if (/^0?\.[0-9]*$/.test(value)) {
    return value
  }

  throw new Error(`Invalid percentage value: expected float in range [0, 1), got ${value}`)
})
const positiveIntegerValidator = envalid.makeValidator((value) => {
  if (/^[0-9]+$/.test(value)) {
    return value
  }

  throw new Error(`Invalid value: expected a positive integer, got ${value}`)
})
const nonNegativeIntegerValidator = envalid.makeValidator((value) => {
  if (/^[0-9]*$/.test(value)) {
    return value || '0'
  }

  throw new Error(`Invalid value: expected a non-negative integer, got ${value}`)
})

function checkLimits(min, max, daily, prefix) {
  if (toBN(min).gte(toBN(max)) || toBN(max).gte(toBN(daily))) {
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
  DEPLOYMENT_GAS_LIMIT_EXTRA: percentageValidator(),
  HOME_DEPLOYMENT_GAS_PRICE: nonNegativeIntegerValidator(),
  FOREIGN_DEPLOYMENT_GAS_PRICE: nonNegativeIntegerValidator(),
  HOME_RPC_URL: envalid.url(),
  HOME_BRIDGE_OWNER: addressValidator(),
  HOME_UPGRADEABLE_ADMIN: addressValidator(),
  FOREIGN_RPC_URL: envalid.url(),
  FOREIGN_BRIDGE_OWNER: addressValidator(),
  FOREIGN_UPGRADEABLE_ADMIN: addressValidator(),
}

switch (BRIDGE_MODE) {
  case 'OMNIBRIDGE':
    validations = {
      ...validations,
      HOME_AMB_BRIDGE: addressValidator(),
      FOREIGN_AMB_BRIDGE: addressValidator(),
      HOME_MEDIATOR_REQUEST_GAS_LIMIT: positiveIntegerValidator(),
      FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT: positiveIntegerValidator(),
      FOREIGN_MIN_AMOUNT_PER_TX: positiveIntegerValidator(),
      FOREIGN_MAX_AMOUNT_PER_TX: positiveIntegerValidator(),
      FOREIGN_DAILY_LIMIT: positiveIntegerValidator(),
      HOME_MIN_AMOUNT_PER_TX: positiveIntegerValidator(),
      HOME_MAX_AMOUNT_PER_TX: positiveIntegerValidator(),
      HOME_DAILY_LIMIT: positiveIntegerValidator(),
      HOME_ERC677_TOKEN_IMAGE: optionalAddressValidator(),
      HOME_TOKEN_FACTORY: optionalAddressValidator(),
      FOREIGN_ERC677_TOKEN_IMAGE: optionalAddressValidator(),
      FOREIGN_TOKEN_FACTORY: optionalAddressValidator(),
    }

    if (HOME_REWARDABLE === 'BOTH_DIRECTIONS') {
      validations = {
        ...validations,
        HOME_MEDIATOR_REWARD_ACCOUNTS: addressesValidator(),
        HOME_TRANSACTIONS_FEE: percentageValidator(),
        FOREIGN_TRANSACTIONS_FEE: percentageValidator(),
      }
    }
    break
  default:
    throw new Error(`Invalid BRIDGE_MODE=${BRIDGE_MODE}. Only OMNIBRIDGE is supported.`)
}

const env = envalid.cleanEnv(process.env, validations)

checkLimits(env.HOME_MIN_AMOUNT_PER_TX, env.HOME_MAX_AMOUNT_PER_TX, env.HOME_DAILY_LIMIT, homePrefix)
checkLimits(env.FOREIGN_MIN_AMOUNT_PER_TX, env.FOREIGN_MAX_AMOUNT_PER_TX, env.FOREIGN_DAILY_LIMIT, foreignPrefix)

module.exports = env
