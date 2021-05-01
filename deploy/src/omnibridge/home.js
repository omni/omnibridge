const { toWei } = require('web3').utils
const { web3Home, deploymentAddress } = require('../web3')
const { deployContract, upgradeProxy } = require('../deploymentUtils')
const {
  HOME_ERC677_TOKEN_IMAGE,
  HOME_TOKEN_FACTORY,
  HOME_FORWARDING_RULES_MANAGER,
  HOME_BRIDGE_OWNER,
  HOME_REWARDABLE,
  HOME_TRANSACTIONS_FEE,
  FOREIGN_TRANSACTIONS_FEE,
  HOME_MEDIATOR_REWARD_ACCOUNTS,
  HOME_AMB_BRIDGE,
  HOME_MEDIATOR_REQUEST_GAS_LIMIT,
  HOME_TOKEN_NAME_SUFFIX,
} = require('../loadEnv')
const { ZERO_ADDRESS } = require('../constants')

const {
  EternalStorageProxy,
  HomeOmnibridge,
  PermittableToken,
  TokenFactory,
  OmnibridgeFeeManager,
  SelectorTokenGasLimitManager,
  MultiTokenForwardingRulesManager,
} = require('../loadContracts')

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

  let feeManager = ZERO_ADDRESS
  if (HOME_REWARDABLE === 'BOTH_DIRECTIONS') {
    const homeFeeInWei = toWei(HOME_TRANSACTIONS_FEE.toString(), 'ether')
    const foreignFeeInWei = toWei(FOREIGN_TRANSACTIONS_FEE.toString(), 'ether')
    const rewardList = HOME_MEDIATOR_REWARD_ACCOUNTS.split(' ')
    console.log(`[Home] Deploying Fee Manager contract with the following parameters:
    REWARD_ADDRESS_LIST: [${rewardList.join(', ')}]
    HOME_TO_FOREIGN_FEE: ${homeFeeInWei} which is ${HOME_TRANSACTIONS_FEE * 100}%
    FOREIGN_TO_HOME_FEE: ${foreignFeeInWei} which is ${FOREIGN_TRANSACTIONS_FEE * 100}%
    `)
    const manager = await deployContract(
      OmnibridgeFeeManager,
      [homeBridgeStorage.options.address, HOME_BRIDGE_OWNER, rewardList, [homeFeeInWei, foreignFeeInWei]],
      { nonce: nonce++ }
    )
    feeManager = manager.options.address
    console.log('\n[Home] New fee manager has been deployed: ', feeManager)
  }

  let forwardingRulesManager = HOME_FORWARDING_RULES_MANAGER === false ? ZERO_ADDRESS : HOME_FORWARDING_RULES_MANAGER
  if (forwardingRulesManager === '') {
    console.log(`\n[Home] Deploying Forwarding Rules Manager contract with the following parameters:
    OWNER: ${HOME_BRIDGE_OWNER}
    `)
    const manager = await deployContract(MultiTokenForwardingRulesManager, [HOME_BRIDGE_OWNER], { nonce: nonce++ })
    forwardingRulesManager = manager.options.address
    console.log('\n[Home] New Forwarding Rules Manager has been deployed: ', forwardingRulesManager)
  } else {
    console.log('\n[Home] Using existing Forwarding Rules Manager: ', forwardingRulesManager)
  }

  console.log(`\n[Home] Deploying gas limit manager contract with the following parameters:
    HOME_AMB_BRIDGE: ${HOME_AMB_BRIDGE}
    OWNER: ${HOME_BRIDGE_OWNER}
  `)
  const gasLimitManager = await deployContract(
    SelectorTokenGasLimitManager,
    [HOME_AMB_BRIDGE, HOME_BRIDGE_OWNER, HOME_MEDIATOR_REQUEST_GAS_LIMIT],
    { nonce: nonce++ }
  )
  console.log('\n[Home] New Gas Limit Manager has been deployed: ', gasLimitManager.options.address)
  console.log('[Home] Manual setup of request gas limits in the manager is recommended.')
  console.log('[Home] Please, call setCommonRequestGasLimits on the Gas Limit Manager contract.')

  console.log('\n[Home] Deploying Bridge Mediator implementation with the following parameters:')
  console.log(`    TOKEN_NAME_SUFFIX: ${HOME_TOKEN_NAME_SUFFIX}\n`)
  const homeBridgeImplementation = await deployContract(HomeOmnibridge, [HOME_TOKEN_NAME_SUFFIX], {
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
    feeManager: { address: feeManager },
    gasLimitManager: { address: gasLimitManager.options.address },
    forwardingRulesManager: { address: forwardingRulesManager },
  }
}

module.exports = deployHome
