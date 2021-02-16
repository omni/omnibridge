const { fromWei } = require('web3').utils
const { web3Home, deploymentAddress } = require('../web3')
const { EternalStorageProxy, HomeOmnibridge } = require('../loadContracts')
const { sendRawTxHome, transferProxyOwnership } = require('../deploymentUtils')

const {
  HOME_DAILY_LIMIT,
  HOME_MAX_AMOUNT_PER_TX,
  HOME_MIN_AMOUNT_PER_TX,
  FOREIGN_DAILY_LIMIT,
  FOREIGN_MAX_AMOUNT_PER_TX,
  HOME_AMB_BRIDGE,
  HOME_MEDIATOR_REQUEST_GAS_LIMIT,
  HOME_BRIDGE_OWNER,
  HOME_UPGRADEABLE_ADMIN,
} = require('../loadEnv')

async function initialize({ homeBridge, foreignBridge, tokenFactory, feeManager }) {
  let nonce = await web3Home.eth.getTransactionCount(deploymentAddress)
  const contract = new web3Home.eth.Contract(HomeOmnibridge.abi, homeBridge)

  console.log('\n[Home] Initializing Bridge Mediator with following parameters:')

  console.log(`
    AMB contract: ${HOME_AMB_BRIDGE},
    Mediator contract: ${foreignBridge},
    DAILY_LIMIT: ${HOME_DAILY_LIMIT} which is ${fromWei(HOME_DAILY_LIMIT)} in eth,
    MAX_AMOUNT_PER_TX: ${HOME_MAX_AMOUNT_PER_TX} which is ${fromWei(HOME_MAX_AMOUNT_PER_TX)} in eth,
    MIN_AMOUNT_PER_TX: ${HOME_MIN_AMOUNT_PER_TX} which is ${fromWei(HOME_MIN_AMOUNT_PER_TX)} in eth,
    EXECUTION_DAILY_LIMIT : ${FOREIGN_DAILY_LIMIT} which is ${fromWei(FOREIGN_DAILY_LIMIT)} in eth,
    EXECUTION_MAX_AMOUNT_PER_TX: ${FOREIGN_MAX_AMOUNT_PER_TX} which is ${fromWei(FOREIGN_MAX_AMOUNT_PER_TX)} in eth,
    MEDIATOR_REQUEST_GAS_LIMIT: ${HOME_MEDIATOR_REQUEST_GAS_LIMIT},
    OWNER: ${HOME_BRIDGE_OWNER},
    TOKEN_FACTORY: ${tokenFactory},
    FEE_MANAGER: ${feeManager}
    `)

  const initializeMediatorData = contract.methods
    .initialize(
      HOME_AMB_BRIDGE,
      foreignBridge,
      [HOME_DAILY_LIMIT, HOME_MAX_AMOUNT_PER_TX, HOME_MIN_AMOUNT_PER_TX],
      [FOREIGN_DAILY_LIMIT, FOREIGN_MAX_AMOUNT_PER_TX],
      HOME_MEDIATOR_REQUEST_GAS_LIMIT,
      HOME_BRIDGE_OWNER,
      tokenFactory,
      feeManager
    )
    .encodeABI()

  await sendRawTxHome({
    data: initializeMediatorData,
    nonce: nonce++,
    to: homeBridge,
  })

  console.log('\n[Home] Transferring bridge mediator proxy ownership to upgradeability admin')
  const proxy = new web3Home.eth.Contract(EternalStorageProxy.abi, homeBridge)
  await transferProxyOwnership({
    proxy,
    newOwner: HOME_UPGRADEABLE_ADMIN,
    nonce: nonce++,
  })
}

module.exports = initialize
