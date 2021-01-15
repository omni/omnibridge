const { fromWei, toWei } = require('web3').utils
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
  HOME_REWARDABLE,
  HOME_TRANSACTIONS_FEE,
  FOREIGN_TRANSACTIONS_FEE,
  HOME_MEDIATOR_REWARD_ACCOUNTS,
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
    requestGasLimit,
    owner,
    tokenFactory,
    rewardAddressList,
    homeToForeignFee,
    foreignToHomeFee,
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
    MEDIATOR_REQUEST_GAS_LIMIT : ${requestGasLimit},
    OWNER: ${owner},
    TOKEN_FACTORY: ${tokenFactory},
    REWARD_ADDRESS_LIST: [${rewardAddressList.join(', ')}]
  `)
  if (HOME_REWARDABLE === 'BOTH_DIRECTIONS') {
    console.log(`
    HOME_TO_FOREIGN_FEE: ${homeToForeignFee} which is ${HOME_TRANSACTIONS_FEE * 100}%
    FOREIGN_TO_HOME_FEE: ${foreignToHomeFee} which is ${FOREIGN_TRANSACTIONS_FEE * 100}%
    `)
  }

  return contract.methods
    .initialize(
      bridgeContract,
      mediatorContract,
      [dailyLimit.toString(), maxPerTx.toString(), minPerTx.toString()],
      [executionDailyLimit.toString(), executionMaxPerTx.toString()],
      requestGasLimit.toString(),
      owner,
      tokenFactory,
      rewardAddressList,
      [homeToForeignFee.toString(), foreignToHomeFee.toString()]
    )
    .encodeABI()
}

async function initialize({ homeBridge, foreignBridge, tokenFactory }) {
  let nonce = await web3Home.eth.getTransactionCount(deploymentAddress)
  const mediatorContract = new web3Home.eth.Contract(HomeOmnibridge.abi, homeBridge)

  console.log('\n[Home] Initializing Bridge Mediator with following parameters:')
  let homeFeeInWei = '0'
  let foreignFeeInWei = '0'
  if (HOME_REWARDABLE === 'BOTH_DIRECTIONS') {
    homeFeeInWei = toWei(HOME_TRANSACTIONS_FEE.toString(), 'ether')
    foreignFeeInWei = toWei(FOREIGN_TRANSACTIONS_FEE.toString(), 'ether')
  }
  const rewardList = HOME_MEDIATOR_REWARD_ACCOUNTS.split(' ')

  const initializeMediatorData = await initializeMediator({
    contract: mediatorContract,
    params: {
      bridgeContract: HOME_AMB_BRIDGE,
      mediatorContract: foreignBridge,
      requestGasLimit: HOME_MEDIATOR_REQUEST_GAS_LIMIT,
      owner: HOME_BRIDGE_OWNER,
      dailyLimit: HOME_DAILY_LIMIT,
      maxPerTx: HOME_MAX_AMOUNT_PER_TX,
      minPerTx: HOME_MIN_AMOUNT_PER_TX,
      executionDailyLimit: FOREIGN_DAILY_LIMIT,
      executionMaxPerTx: FOREIGN_MAX_AMOUNT_PER_TX,
      tokenFactory,
      rewardAddressList: rewardList,
      homeToForeignFee: homeFeeInWei,
      foreignToHomeFee: foreignFeeInWei,
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
