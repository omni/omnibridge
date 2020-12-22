const { fromWei } = require('web3').utils
const { web3Home, deploymentAddress } = require('../web3')
const { EternalStorageProxy, HomeNFTOmnibridge } = require('../loadContracts')
const { sendRawTxHome, transferProxyOwnership } = require('../deploymentUtils')

const {
  HOME_DAILY_LIMIT,
  FOREIGN_DAILY_LIMIT,
  HOME_AMB_BRIDGE,
  HOME_MEDIATOR_REQUEST_GAS_LIMIT,
  HOME_BRIDGE_OWNER,
  HOME_UPGRADEABLE_ADMIN,
} = require('../loadEnv')

async function initializeMediator({
  contract,
  params: { bridgeContract, mediatorContract, dailyLimit, executionDailyLimit, requestGasLimit, owner, tokenImage },
}) {
  console.log(`
    AMB contract: ${bridgeContract},
    Mediator contract: ${mediatorContract},
    DAILY_LIMIT : ${dailyLimit} which is ${fromWei(dailyLimit)} in eth,
    EXECUTION_DAILY_LIMIT : ${executionDailyLimit} which is ${fromWei(executionDailyLimit)} in eth,
    MEDIATOR_REQUEST_GAS_LIMIT : ${requestGasLimit},
    OWNER: ${owner},
    TOKEN_IMAGE: ${tokenImage}`)

  return contract.methods
    .initialize(bridgeContract, mediatorContract, dailyLimit, executionDailyLimit, requestGasLimit, owner, tokenImage)
    .encodeABI()
}

async function initialize({ homeBridge, foreignBridge, tokenImage }) {
  let nonce = await web3Home.eth.getTransactionCount(deploymentAddress)
  const mediatorContract = new web3Home.eth.Contract(HomeNFTOmnibridge.abi, homeBridge)

  console.log('\n[Home] Initializing Bridge Mediator with following parameters:')

  const initializeMediatorData = await initializeMediator({
    contract: mediatorContract,
    params: {
      bridgeContract: HOME_AMB_BRIDGE,
      mediatorContract: foreignBridge,
      requestGasLimit: HOME_MEDIATOR_REQUEST_GAS_LIMIT,
      owner: HOME_BRIDGE_OWNER,
      dailyLimit: HOME_DAILY_LIMIT,
      executionDailyLimit: FOREIGN_DAILY_LIMIT,
      tokenImage,
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
