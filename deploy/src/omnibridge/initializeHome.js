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
  HOME_BRIDGE_OWNER,
  HOME_UPGRADEABLE_ADMIN,
} = require('../loadEnv')

async function initializeMediator({
  contract,
  params: {
    bridgeContract,
    mediatorContract,
    dailyLimit,
    maxPerTx,
    minPerTx,
    executionDailyLimit,
    executionMaxPerTx,
    owner,
    tokenFactory,
    feeManager,
    gasLimitManager,
    forwardingRulesManager,
  },
}) {
  console.log(`
    AMB contract: ${bridgeContract},
    Mediator contract: ${mediatorContract},
    DAILY_LIMIT : ${dailyLimit} which is ${fromWei(dailyLimit)} in eth,
    MAX_AMOUNT_PER_TX: ${maxPerTx} which is ${fromWei(maxPerTx)} in eth,
    MIN_AMOUNT_PER_TX: ${minPerTx} which is ${fromWei(minPerTx)} in eth,
    EXECUTION_DAILY_LIMIT : ${executionDailyLimit} which is ${fromWei(executionDailyLimit)} in eth,
    EXECUTION_MAX_AMOUNT_PER_TX: ${executionMaxPerTx} which is ${fromWei(executionMaxPerTx)} in eth,
    OWNER: ${owner},
    TOKEN_FACTORY: ${tokenFactory},
    FEE_MANAGER: ${feeManager},
    GAS_LIMIT_MANAGER: ${gasLimitManager},
    FORWARDING_RULES_MANAGER: ${forwardingRulesManager},
  `)

  return contract.methods
    .initialize(
      bridgeContract,
      mediatorContract,
      [dailyLimit.toString(), maxPerTx.toString(), minPerTx.toString()],
      [executionDailyLimit.toString(), executionMaxPerTx.toString()],
      gasLimitManager,
      owner,
      tokenFactory,
      feeManager,
      forwardingRulesManager
    )
    .encodeABI()
}

async function initialize({
  homeBridge,
  foreignBridge,
  tokenFactory,
  feeManager,
  gasLimitManager,
  forwardingRulesManager,
}) {
  let nonce = await web3Home.eth.getTransactionCount(deploymentAddress)
  const mediatorContract = new web3Home.eth.Contract(HomeOmnibridge.abi, homeBridge)

  console.log('\n[Home] Initializing Bridge Mediator with following parameters:')

  const initializeMediatorData = await initializeMediator({
    contract: mediatorContract,
    params: {
      bridgeContract: HOME_AMB_BRIDGE,
      mediatorContract: foreignBridge,
      owner: HOME_BRIDGE_OWNER,
      dailyLimit: HOME_DAILY_LIMIT,
      maxPerTx: HOME_MAX_AMOUNT_PER_TX,
      minPerTx: HOME_MIN_AMOUNT_PER_TX,
      executionDailyLimit: FOREIGN_DAILY_LIMIT,
      executionMaxPerTx: FOREIGN_MAX_AMOUNT_PER_TX,
      tokenFactory,
      feeManager,
      gasLimitManager,
      forwardingRulesManager,
    },
  })

  await sendRawTxHome({
    data: initializeMediatorData,
    nonce: nonce++,
    to: homeBridge,
  })

  console.log('\n[Home] Transferring bridge mediator proxy ownership to upgradeability admin')
  const mediatorProxy = new web3Home.eth.Contract(EternalStorageProxy.abi, homeBridge)
  await transferProxyOwnership({
    proxy: mediatorProxy,
    newOwner: HOME_UPGRADEABLE_ADMIN,
    nonce: nonce++,
  })
}

module.exports = initialize
