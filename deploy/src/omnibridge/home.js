const { web3Home, deploymentAddress } = require('../web3')
const { deployContract, upgradeProxy } = require('../deploymentUtils')
const { HOME_ERC677_TOKEN_IMAGE, HOME_TOKEN_FACTORY, HOME_BRIDGE_OWNER } = require('../loadEnv')

const { EternalStorageProxy, HomeOmnibridge, PermittableToken, TokenFactory } = require('../loadContracts')

async function deployHome() {
  let nonce = await web3Home.eth.getTransactionCount(deploymentAddress)

  console.log('\n[Home] Deploying Bridge Mediator storage\n')
  const homeBridgeStorage = await deployContract(EternalStorageProxy, [], {
    nonce: nonce++,
  })
  console.log('[Home] Bridge Mediator Storage: ', homeBridgeStorage.options.address)

  let tokenFactory = HOME_TOKEN_FACTORY
  if (!tokenFactory) {
    let homeTokenImage = HOME_ERC677_TOKEN_IMAGE
    if (!homeTokenImage) {
      console.log('\n[Home] Deploying new ERC677 token image')
      const chainId = await web3Home.eth.getChainId()
      const erc677token = await deployContract(PermittableToken, ['', '', 0, chainId], {
        nonce: nonce++,
      })
      homeTokenImage = erc677token.options.address
      console.log('\n[Home] New ERC677 token image has been deployed: ', homeTokenImage)
    } else {
      console.log('\n[Home] Using existing ERC677 token image: ', homeTokenImage)
    }
    console.log('\n[Home] Deploying new token factory')
    const factory = await deployContract(TokenFactory, [HOME_BRIDGE_OWNER, homeTokenImage], {
      nonce: nonce++,
    })
    tokenFactory = factory.options.address
    console.log('\n[Home] New token factory has been deployed: ', tokenFactory)
  } else {
    console.log('\n[Home] Using existing token factory: ', tokenFactory)
  }

  console.log('\n[Home] Deploying Bridge Mediator implementation\n')
  const homeBridgeImplementation = await deployContract(HomeOmnibridge, [], {
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

  console.log('\nHome part of OMNIBRIDGE has been deployed\n')
  return {
    homeBridgeMediator: { address: homeBridgeStorage.options.address },
    tokenFactory: { address: tokenFactory },
  }
}

module.exports = deployHome
