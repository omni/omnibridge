/* eslint-disable no-param-reassign */
const assert = require('assert')
const {
  web3Home,
  web3Foreign,
  deploymentAddress,
  GAS_LIMIT_EXTRA,
  HOME_DEPLOYMENT_GAS_PRICE,
  FOREIGN_DEPLOYMENT_GAS_PRICE,
  HOME_EXPLORER_URL,
  FOREIGN_EXPLORER_URL,
  HOME_EXPLORER_API_KEY,
  FOREIGN_EXPLORER_API_KEY,
  DEPLOYMENT_ACCOUNT_PRIVATE_KEY,
} = require('./web3')
const verifier = require('./utils/verifier')

async function deployContract(contractJson, args, { network, nonce }) {
  let web3
  let apiUrl
  let apiKey
  if (network === 'foreign') {
    web3 = web3Foreign
    apiUrl = FOREIGN_EXPLORER_URL
    apiKey = FOREIGN_EXPLORER_API_KEY
  } else {
    web3 = web3Home
    apiUrl = HOME_EXPLORER_URL
    apiKey = HOME_EXPLORER_API_KEY
  }
  const instance = new web3.eth.Contract(contractJson.abi)
  const result = instance
    .deploy({
      data: contractJson.bytecode,
      arguments: args,
    })
    .encodeABI()
  const receipt = await sendTx(network, {
    data: result,
    nonce,
    to: null,
  })
  instance.options.address = receipt.contractAddress
  instance.deployedBlockNumber = receipt.blockNumber

  if (apiUrl) {
    let constructorArguments
    if (args.length) {
      constructorArguments = result.substring(contractJson.bytecode.length)
    }
    await verifier({ artifact: contractJson, constructorArguments, address: receipt.contractAddress, apiUrl, apiKey })
  }

  return instance
}

function sendTx(network, options) {
  return (network === 'foreign' ? sendRawTxForeign : sendRawTxHome)(options)
}

async function sendRawTxHome(options) {
  return sendRawTx({
    ...options,
    gasPrice: HOME_DEPLOYMENT_GAS_PRICE,
    web3: web3Home,
  })
}

async function sendRawTxForeign(options) {
  return sendRawTx({
    ...options,
    gasPrice: FOREIGN_DEPLOYMENT_GAS_PRICE,
    web3: web3Foreign,
  })
}

async function sendRawTx({ data, nonce, to, web3, gasPrice, value }) {
  try {
    const estimatedGas = await web3.eth.estimateGas({
      from: deploymentAddress,
      value,
      to,
      data,
    })

    const blockData = await web3.eth.getBlock('latest')
    const blockGasLimit = blockData.gasLimit
    if (estimatedGas > blockGasLimit) {
      throw new Error(`estimated gas greater (${estimatedGas}) than the block gas limit (${blockGasLimit})`)
    }

    const rawTx = {
      nonce,
      gasPrice,
      gasLimit: Math.min(Math.ceil(estimatedGas * (1 + parseFloat(GAS_LIMIT_EXTRA))), blockGasLimit),
      to,
      data,
      value,
    }

    const signedTx = await web3.eth.accounts.signTransaction(rawTx, DEPLOYMENT_ACCOUNT_PRIVATE_KEY)
    const receipt = await web3.eth
      .sendSignedTransaction(signedTx.rawTransaction)
      .once('transactionHash', (txHash) => console.log('pending txHash', txHash))
      .on('error', (e) => {
        throw e
      })
    assert.ok(receipt.status, 'Transaction Failed')
    return receipt
  } catch (e) {
    console.error(e)
  }
  return null
}

async function upgradeProxy({ proxy, implementationAddress, version, nonce, network }) {
  await sendTx(network, {
    data: proxy.methods.upgradeTo(version, implementationAddress).encodeABI(),
    nonce,
    to: proxy.options.address,
  })
}

async function transferProxyOwnership({ proxy, newOwner, nonce, network }) {
  await sendTx(network, {
    data: proxy.methods.transferProxyOwnership(newOwner).encodeABI(),
    nonce,
    to: proxy.options.address,
  })
}

async function transferOwnership({ contract, newOwner, nonce, network }) {
  await sendTx(network, {
    data: contract.methods.transferOwnership(newOwner).encodeABI(),
    nonce,
    to: contract.options.address,
  })
}

async function setBridgeContract({ contract, bridgeAddress, nonce, network }) {
  await sendTx(network, {
    data: contract.methods.setBridgeContract(bridgeAddress).encodeABI(),
    nonce,
    to: contract.options.address,
  })
}

async function isContract(web3, address) {
  const code = await web3.eth.getCode(address)
  return code !== '0x' && code !== '0x0'
}

module.exports = {
  deployContract,
  sendRawTxHome,
  sendRawTxForeign,
  upgradeProxy,
  transferProxyOwnership,
  transferOwnership,
  setBridgeContract,
  isContract,
}
