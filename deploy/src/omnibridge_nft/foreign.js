const { web3Foreign, deploymentAddress } = require('../web3')
const { deployContract, upgradeProxy } = require('../deploymentUtils')
const { EternalStorageProxy, ForeignNFTOmnibridge, ERC721BridgeToken } = require('../loadContracts')
const { FOREIGN_ERC721_TOKEN_IMAGE } = require('../loadEnv')
const { ZERO_ADDRESS } = require('../constants')

async function deployForeign() {
  let nonce = await web3Foreign.eth.getTransactionCount(deploymentAddress)

  console.log('\n[Foreign] Deploying Bridge Mediator storage\n')
  const foreignBridgeStorage = await deployContract(EternalStorageProxy, [], {
    network: 'foreign',
    nonce: nonce++,
  })
  console.log('[Foreign] Bridge Mediator Storage: ', foreignBridgeStorage.options.address)

  let tokenImage = FOREIGN_ERC721_TOKEN_IMAGE
  if (!tokenImage) {
    console.log('\n[Foreign] Deploying new token image')
    const image = await deployContract(ERC721BridgeToken, ['', '', ZERO_ADDRESS], {
      network: 'foreign',
      nonce: nonce++,
    })
    tokenImage = image.options.address
    console.log('\n[Foreign] New token image has been deployed: ', tokenImage)
  } else {
    console.log('\n[Foreign] Using existing token image: ', tokenImage)
  }

  console.log('\n[Foreign] Deploying Bridge Mediator implementation\n')
  const foreignBridgeImplementation = await deployContract(ForeignNFTOmnibridge, [], {
    network: 'foreign',
    nonce: nonce++,
  })
  console.log('[Foreign] Bridge Mediator Implementation: ', foreignBridgeImplementation.options.address)

  console.log('\n[Foreign] Hooking up Mediator storage to Mediator implementation')
  await upgradeProxy({
    network: 'foreign',
    proxy: foreignBridgeStorage,
    implementationAddress: foreignBridgeImplementation.options.address,
    version: '1',
    nonce: nonce++,
  })

  console.log('\nForeign part of OMNIBRIDGE_NFT has been deployed\n')
  return {
    foreignBridgeMediator: { address: foreignBridgeStorage.options.address },
    tokenImage: { address: tokenImage },
  }
}

module.exports = deployForeign
