const fs = require('fs')
const path = require('path')
const env = require('./src/loadEnv')

const { BRIDGE_MODE } = env

const deployResultsPath = path.join(__dirname, './bridgeDeploymentResults.json')

function writeDeploymentResults(data) {
  fs.writeFileSync(deployResultsPath, JSON.stringify(data, null, 4))
  console.log('Contracts Deployment have been saved to `bridgeDeploymentResults.json`')
}

async function deployMultiAMBErcToErc() {
  const preDeploy = require('./src/multi_amb_erc20_to_erc677/preDeploy')
  const deployHome = require('./src/multi_amb_erc20_to_erc677/home')
  const deployForeign = require('./src/multi_amb_erc20_to_erc677/foreign')
  const initializeHome = require('./src/multi_amb_erc20_to_erc677/initializeHome')
  const initializeForeign = require('./src/multi_amb_erc20_to_erc677/initializeForeign')
  await preDeploy()
  const { homeBridgeMediator, tokenFactory: homeTokenFactory } = await deployHome()
  const { foreignBridgeMediator, tokenFactory: foreignTokenFactory } = await deployForeign()

  await initializeHome({
    homeBridge: homeBridgeMediator.address,
    foreignBridge: foreignBridgeMediator.address,
    tokenFactory: homeTokenFactory.address,
  })

  await initializeForeign({
    foreignBridge: foreignBridgeMediator.address,
    homeBridge: homeBridgeMediator.address,
    tokenFactory: foreignTokenFactory.address,
  })

  console.log('\nDeployment has been completed.\n\n')
  console.log(`[   Home  ] Bridge Mediator: ${homeBridgeMediator.address}`)
  console.log(`[ Foreign ] Bridge Mediator: ${foreignBridgeMediator.address}`)
  writeDeploymentResults({
    homeBridge: {
      homeBridgeMediator,
    },
    foreignBridge: {
      foreignBridgeMediator,
    },
  })
}

async function main() {
  console.log(`Bridge mode: ${BRIDGE_MODE}`)
  switch (BRIDGE_MODE) {
    case 'MULTI_AMB_ERC_TO_ERC':
      await deployMultiAMBErcToErc()
      break
    default:
      console.log(BRIDGE_MODE)
      throw new Error('Please specify BRIDGE_MODE: MULTI_AMB_ERC_TO_ERC')
  }
}

main().catch((e) => console.log('Error:', e))
