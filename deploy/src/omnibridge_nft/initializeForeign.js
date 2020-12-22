const { fromWei } = require('web3').utils
const { web3Foreign, deploymentAddress } = require('../web3')
const { EternalStorageProxy, ForeignNFTOmnibridge } = require('../loadContracts')
const { sendRawTxForeign, transferProxyOwnership } = require('../deploymentUtils')

const {
  HOME_DAILY_LIMIT,
  FOREIGN_DAILY_LIMIT,
  FOREIGN_BRIDGE_OWNER,
  FOREIGN_UPGRADEABLE_ADMIN,
  FOREIGN_AMB_BRIDGE,
  FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT,
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
  let nonce = await web3Foreign.eth.getTransactionCount(deploymentAddress)
  const contract = new web3Foreign.eth.Contract(ForeignNFTOmnibridge.abi, foreignBridge)

  console.log('\n[Foreign] Initializing Bridge Mediator with following parameters:')

  const initializeData = await initializeMediator({
    contract,
    params: {
      bridgeContract: FOREIGN_AMB_BRIDGE,
      mediatorContract: homeBridge,
      requestGasLimit: FOREIGN_MEDIATOR_REQUEST_GAS_LIMIT,
      owner: FOREIGN_BRIDGE_OWNER,
      dailyLimit: FOREIGN_DAILY_LIMIT,
      executionDailyLimit: HOME_DAILY_LIMIT,
      tokenImage,
    },
  })

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
