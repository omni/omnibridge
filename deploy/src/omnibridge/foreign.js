const { web3Foreign, deploymentAddress } = require('../web3')
const { deployContract, upgradeProxy } = require('../deploymentUtils')
const { EternalStorageProxy, ForeignOmnibridge, PermittableToken, TokenFactory } = require('../loadContracts')
const {
  FOREIGN_TOKEN_FACTORY,
  FOREIGN_ERC677_TOKEN_IMAGE,
  FOREIGN_BRIDGE_OWNER,
  FOREIGN_TOKEN_NAME_SUFFIX,
} = require('../loadEnv')

async function deployForeign() {
  let nonce = await web3Foreign.eth.getTransactionCount(deploymentAddress)

  console.log('\n[Foreign] Deploying Bridge Mediator storage\n')
  const foreignBridgeStorage = await deployContract(EternalStorageProxy, [], {
    network: 'foreign',
    nonce: nonce++,
  })
  console.log('[Foreign] Bridge Mediator Storage: ', foreignBridgeStorage.options.address)

  let tokenFactory = FOREIGN_TOKEN_FACTORY
  if (!tokenFactory) {
    let foreignTokenImage = FOREIGN_ERC677_TOKEN_IMAGE
    if (!foreignTokenImage) {
      console.log('\n[Foreign] Deploying new ERC677 token image')
      const chainId = await web3Foreign.eth.getChainId()
      const erc677token = await deployContract(PermittableToken, ['', '', 0, chainId], {
        network: 'foreign',
        nonce: nonce++,
      })
      foreignTokenImage = erc677token.options.address
      console.log('\n[Foreign] New ERC677 token image has been deployed: ', foreignTokenImage)
    } else {
      console.log('\n[Foreign] Using existing ERC677 token image: ', foreignTokenImage)
    }
    console.log('\n[Foreign] Deploying new token factory')
    const factory = await deployContract(TokenFactory, [FOREIGN_BRIDGE_OWNER, foreignTokenImage], {
      network: 'foreign',
      nonce: nonce++,
    })
    tokenFactory = factory.options.address
    console.log('\n[Foreign] New token factory has been deployed: ', tokenFactory)
  } else {
    console.log('\n[Foreign] Using existing token factory: ', tokenFactory)
  }

  console.log('\n[Foreign] Deploying Bridge Mediator implementation with the following parameters:')
  console.log(`    TOKEN_NAME_SUFFIX: ${FOREIGN_TOKEN_NAME_SUFFIX}\n`)
  const foreignBridgeImplementation = await deployContract(ForeignOmnibridge, [FOREIGN_TOKEN_NAME_SUFFIX], {
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

  console.log('\nForeign part of OMNIBRIDGE has been deployed\n')
  return {
    foreignBridgeMediator: { address: foreignBridgeStorage.options.address },
    tokenFactory: { address: tokenFactory },
  }
}

module.exports = deployForeign
