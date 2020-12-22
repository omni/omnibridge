const { web3Home, deploymentAddress } = require('../web3')
const { deployContract, upgradeProxy } = require('../deploymentUtils')
const { EternalStorageProxy, HomeNFTOmnibridge, ERC721BridgeToken } = require('../loadContracts')
const { HOME_ERC721_TOKEN_IMAGE } = require('../loadEnv')
const { ZERO_ADDRESS } = require('../constants')

async function deployHome() {
  let nonce = await web3Home.eth.getTransactionCount(deploymentAddress)

  console.log('\n[Home] Deploying Bridge Mediator storage\n')
  const homeBridgeStorage = await deployContract(EternalStorageProxy, [], {
    nonce: nonce++,
  })
  console.log('[Home] Bridge Mediator Storage: ', homeBridgeStorage.options.address)

  let tokenImage = HOME_ERC721_TOKEN_IMAGE
  if (!tokenImage) {
    console.log('\n[Home] Deploying new token image')
    const image = await deployContract(ERC721BridgeToken, ['', '', ZERO_ADDRESS], {
      nonce: nonce++,
    })
    tokenImage = image.options.address
    console.log('\n[Home] New token image has been deployed: ', tokenImage)
  } else {
    console.log('\n[Home] Using existing token image: ', tokenImage)
  }

  console.log('\n[Home] Deploying Bridge Mediator implementation\n')
  const homeBridgeImplementation = await deployContract(HomeNFTOmnibridge, [], {
    nonce: nonce++,
  })
  console.log('[Home] Bridge Mediator Implementation: ', homeBridgeImplementation.options.address)

  console.log('\n[Home] Hooking up Mediator storage to Mediator implementation')
  await upgradeProxy({
    proxy: homeBridgeStorage,
    implementationAddress: homeBridgeImplementation.options.address,
    version: '1',
    nonce: nonce++,
  })

  console.log('\nHome part of OMNIBRIDGE_NFT has been deployed\n')
  return {
    homeBridgeMediator: { address: homeBridgeStorage.options.address },
    tokenImage: { address: tokenImage },
  }
}

module.exports = deployHome
