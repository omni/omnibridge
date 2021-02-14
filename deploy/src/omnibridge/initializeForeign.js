const { fromWei } = require('web3').utils
const { web3Foreign, deploymentAddress } = require('../web3')
const { EternalStorageProxy, ForeignOmnibridge } = require('../loadContracts')
const { sendRawTxForeign, transferProxyOwnership } = require('../deploymentUtils')

const {
  HOME_DAILY_LIMIT,
  HOME_MAX_AMOUNT_PER_TX,
  FOREIGN_DAILY_LIMIT,
  FOREIGN_MAX_AMOUNT_PER_TX,
  FOREIGN_MIN_AMOUNT_PER_TX,
  FOREIGN_BRIDGE_OWNER,
  FOREIGN_UPGRADEABLE_ADMIN,
  FOREIGN_AMB_BRIDGE,
  FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT,
} = require('../loadEnv')

async function initialize({ homeBridge, foreignBridge, tokenFactory }) {
  let nonce = await web3Foreign.eth.getTransactionCount(deploymentAddress)
  const contract = new web3Foreign.eth.Contract(ForeignOmnibridge.abi, foreignBridge)

  console.log('\n[Foreign] Initializing Bridge Mediator with following parameters:')

  console.log(`
    AMB contract: ${FOREIGN_AMB_BRIDGE},
    Mediator contract: ${homeBridge},
    DAILY_LIMIT: ${FOREIGN_DAILY_LIMIT} which is ${fromWei(FOREIGN_DAILY_LIMIT)} in eth,
    MAX_AMOUNT_PER_TX: ${FOREIGN_MAX_AMOUNT_PER_TX} which is ${fromWei(FOREIGN_MAX_AMOUNT_PER_TX)} in eth,
    MIN_AMOUNT_PER_TX: ${FOREIGN_MIN_AMOUNT_PER_TX} which is ${fromWei(FOREIGN_MIN_AMOUNT_PER_TX)} in eth,
    EXECUTION_DAILY_LIMIT : ${HOME_DAILY_LIMIT} which is ${fromWei(HOME_DAILY_LIMIT)} in eth,
    EXECUTION_MAX_AMOUNT_PER_TX: ${HOME_MAX_AMOUNT_PER_TX} which is ${fromWei(HOME_MAX_AMOUNT_PER_TX)} in eth,
    MEDIATOR_REQUEST_GAS_LIMIT : ${FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT},
    OWNER: ${FOREIGN_BRIDGE_OWNER},
    TOKEN_FACTORY: ${tokenFactory}`)

  const initializeData = contract.methods
    .initialize(
      FOREIGN_AMB_BRIDGE,
      homeBridge,
      [FOREIGN_DAILY_LIMIT, FOREIGN_MAX_AMOUNT_PER_TX, FOREIGN_MIN_AMOUNT_PER_TX],
      [HOME_DAILY_LIMIT, HOME_MAX_AMOUNT_PER_TX],
      FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT,
      FOREIGN_BRIDGE_OWNER,
      tokenFactory
    )
    .encodeABI()

  await sendRawTxForeign({
    data: initializeData,
    nonce: nonce++,
    to: foreignBridge,
  })

  console.log('\n[Foreign] Transferring bridge mediator proxy ownership to upgradeability admin')
  const proxy = new web3Foreign.eth.Contract(EternalStorageProxy.abi, foreignBridge)
  await transferProxyOwnership({
    network: 'foreign',
    proxy,
    newOwner: FOREIGN_UPGRADEABLE_ADMIN,
    nonce: nonce++,
  })
}

module.exports = initialize
