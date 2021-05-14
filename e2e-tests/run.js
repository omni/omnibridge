const assert = require('assert')
const path = require('path')
require('dotenv').config({
  path: path.join(__dirname, '.env'),
})
const Web3 = require('web3')

const filterEvents = (arr) => arr.filter((x) => x.type === 'event')

const AMBABI = require('../build/contracts/IAMB.json').abi

const AMBEventABI = filterEvents(AMBABI)

const HomeABI = [...require('../build/contracts/HomeOmnibridge.json').abi, ...AMBEventABI]
const ForeignABI = [...require('../build/contracts/ForeignOmnibridge.json').abi, ...AMBEventABI]
const FeeManagerABI = [...require('../build/contracts/OmnibridgeFeeManager.json').abi]
const WETH = require('../build/contracts/WETH.json')
const WETHOmnibridgeRouter = require('../build/contracts/WETHOmnibridgeRouter.json')
const InterestImpl = require('../build/contracts/CompoundInterestERC20Mock.json')
const ComptrollerABI = require('../build/contracts/IHarnessComptroller.json').abi
const CTokenABI = require('../build/contracts/ICToken.json').abi

const WETHOmnibridgeRouterABI = [...WETHOmnibridgeRouter.abi, ...AMBEventABI]

const ERC677 = require('../precompiled/ERC677BridgeToken.json')
const TokenReceiver = require('../build/contracts/TokenReceiver.json')

const scenarios = [
  require('./scenarios/claimForeignTokens'),
  require('./scenarios/claimHomeTokens'),
  require('./scenarios/bridgeNativeForeignTokens'),
  require('./scenarios/bridgeNativeHomeTokens'),
  require('./scenarios/bridgeNativeForeignTokensToOtherUser'),
  require('./scenarios/bridgeNativeHomeTokensToOtherUser'),
  require('./scenarios/fixForeignMediatorBalance'),
  require('./scenarios/fixHomeMediatorBalance'),
  require('./scenarios/homeRequestFailedMessageFix'),
  require('./scenarios/foreignRequestFailedMessageFix'),
  require('./scenarios/bridgeForeignTokensAndCall'),
  require('./scenarios/bridgeHomeTokensAndCall'),
  require('./scenarios/bridgeNativeETH'),
  require('./scenarios/investForeignTokensIntoCompound'),
]
const { toWei, toBN, ZERO_ADDRESS, toAddress, addPendingTxLogger } = require('./utils')

const TokenABI = [...ERC677.abi, ...filterEvents(HomeABI), ...AMBEventABI]

const {
  HOME_RPC_URL,
  FOREIGN_RPC_URL,
  HOME_MEDIATOR_ADDRESS,
  FOREIGN_MEDIATOR_ADDRESS,
  HOME_TOKEN_ADDRESS,
  FOREIGN_TOKEN_ADDRESS,
  HOME_CLAIMABLE_TOKEN_ADDRESS,
  FOREIGN_CLAIMABLE_TOKEN_ADDRESS,
  HOME_GAS_PRICE,
  FOREIGN_GAS_PRICE,
  TEST_ACCOUNT_PRIVATE_KEY,
  SECOND_TEST_ACCOUNT_PRIVATE_KEY,
  OWNER_ACCOUNT_PRIVATE_KEY,
  COMPOUND_FAUCET_PRIVATE_KEY,
  COMPOUND_TOKEN_ADDRESS,
  COMPOUND_CTOKEN_ADDRESS,
  COMPOUND_COMP_ADDRESS,
  COMPOUND_COMPTROLLER_ADDRESS,
} = process.env

function deploy(web3, options, abi, bytecode, args) {
  return new web3.eth.Contract(abi, ZERO_ADDRESS, options)
    .deploy({
      data: bytecode,
      arguments: args,
    })
    .send({
      gas: 5000000,
    })
}

async function deployToken(web3, options, bytecode = ERC677.bytecode) {
  const token = await deploy(web3, options, TokenABI, bytecode, ['Test Token', 'TST', 18])
  console.log(`Deployed token ${token.options.address}`)
  console.log(`Minting 1000 tokens to the ${options.from}`)
  await token.methods.mint(options.from, toWei('1000')).send()
  return token
}

async function deployTokenReceiver(web3, options) {
  const tokenReceiver = await deploy(web3, options, TokenReceiver.abi, TokenReceiver.bytecode)
  console.log(`Deployed token receiver ${tokenReceiver.options.address}`)
  return tokenReceiver
}

async function deployWETH(web3, options) {
  const contract = await deploy(web3, options, WETH.abi, WETH.bytecode)
  console.log(`Deployed WETH token ${contract.options.address}`)
  return contract
}

async function deployWETHRouter(web3, options, bridge, WETH, owner) {
  const args = [toAddress(bridge), toAddress(WETH), owner]
  const contract = await deploy(web3, options, WETHOmnibridgeRouterABI, WETHOmnibridgeRouter.bytecode, args)
  console.log(`Deployed WETHOmnibridgeRouter token ${contract.options.address}`)
  return contract
}

async function deployInterestImpl(web3, mediator, owner, cToken, options) {
  const args = [toAddress(mediator), owner, '1', owner]
  const contract = await deploy(web3, options, InterestImpl.abi, InterestImpl.bytecode, args)
  await contract.methods.enableInterestToken(toAddress(cToken), toWei('1'), owner, toWei('1')).send({ from: owner })
  console.log(`Deployed Interest implementation contract ${contract.options.address}`)
  return contract
}

const findMessageId = (receipt) =>
  Object.values(receipt.events)
    .flat()
    .map((e) => e.returnValues.messageId)
    .find((messageId) => !!messageId)

function makeWaitUntilProcessed(contract, finalizationEvent, blockNumber) {
  return async (receipt) => {
    assert.ok(receipt.status, 'Transaction with AMB request has failed')
    const messageId = findMessageId(receipt)
    assert.ok(!!messageId, 'No event with messageId field was found')
    console.log(`Waiting for message ${messageId} to be processed`)
    let attempt = 0
    while (attempt++ < 20) {
      await new Promise((res) => setTimeout(res, 5000))
      const events = await contract.getPastEvents(finalizationEvent, {
        filter: {
          messageId,
        },
        fromBlock: blockNumber,
        toBlock: 'latest',
      })
      if (events.length > 0) {
        return events[0].returnValues.status && events[0].transactionHash
      }
    }
    throw new Error('Message is not processed after 2 minutes, check if AMB validators are working correctly')
  }
}

function makeCheckTransfer(web3) {
  return async (txHash, token, from, to, value) => {
    const tokenAddr = toAddress(token)
    const fromAddr = toAddress(from)
    const toAddr = toAddress(to)
    const str = `Transfer(${fromAddr}, ${toAddr}, ${value || 'any'})`
    console.log(`Checking if transaction has the required ${str}`)
    const { logs } = await web3.eth.getTransactionReceipt(txHash)
    const sig = web3.eth.abi.encodeEventSignature('Transfer(address,address,uint256)')
    const inputs = ERC677.abi.find((e) => e.type === 'event' && e.name === 'Transfer' && e.inputs.length === 3).inputs
    const transfers = logs
      .filter((log) => log.topics[0] === sig && log.address === tokenAddr)
      .map((log) => web3.eth.abi.decodeLog(inputs, log.data, log.topics.slice(1)))
    assert.ok(transfers.length > 0, `No transfers are found for the token ${tokenAddr}`)
    assert.ok(
      transfers.some(
        (transfer) =>
          transfer.from === fromAddr && transfer.to === toAddr && (value === null || transfer.value === value)
      ),
      `No ${str} was found in the logs, found transfers:\n${transfers
        .map((e) => `- Transfer(${e.from}, ${e.to}, ${e.value})`)
        .join(',\n')}`
    )
  }
}

function makeGetBridgedToken(web3, mediator, options) {
  return async (token) => {
    console.log('Getting address of the bridged token')
    const bridgedAddress = await mediator.methods.bridgedTokenAddress(toAddress(token)).call()
    assert.notStrictEqual(bridgedAddress, ZERO_ADDRESS, 'Bridged token address is not initialized')
    return new web3.eth.Contract(TokenABI, bridgedAddress, options)
  }
}

function makeWithDisabledExecution(mediator, owner) {
  return async (token, f) => {
    const tokenAddr = toAddress(token)
    const limit = await mediator.methods.executionDailyLimit(tokenAddr).call()
    console.log(`Disabling execution for ${tokenAddr}`)
    await mediator.methods.setExecutionDailyLimit(tokenAddr, 0).send({ from: owner })
    await f().finally(() => {
      console.log(`Enabling back execution for ${tokenAddr}`)
      return mediator.methods.setExecutionDailyLimit(tokenAddr, limit).send({ from: owner })
    })
  }
}

async function createEnv(web3Home, web3Foreign) {
  console.log('Import accounts')
  const users = []
  users.push(web3Home.eth.accounts.wallet.add(TEST_ACCOUNT_PRIVATE_KEY).address)
  web3Foreign.eth.accounts.wallet.add(TEST_ACCOUNT_PRIVATE_KEY)
  if (SECOND_TEST_ACCOUNT_PRIVATE_KEY) {
    users.push(web3Home.eth.accounts.wallet.add(SECOND_TEST_ACCOUNT_PRIVATE_KEY).address)
    web3Foreign.eth.accounts.wallet.add(SECOND_TEST_ACCOUNT_PRIVATE_KEY)
  }
  let owner = null
  if (OWNER_ACCOUNT_PRIVATE_KEY) {
    owner = web3Home.eth.accounts.wallet.add(OWNER_ACCOUNT_PRIVATE_KEY).address
    web3Foreign.eth.accounts.wallet.add(OWNER_ACCOUNT_PRIVATE_KEY)
  }

  const homeOptions = {
    from: users[0],
    gas: 1000000,
    gasPrice: HOME_GAS_PRICE,
  }
  const foreignOptions = {
    from: users[0],
    gas: 1000000,
    gasPrice: FOREIGN_GAS_PRICE,
  }

  console.log('Initializing mediators contracts')
  const homeMediator = new web3Home.eth.Contract(HomeABI, HOME_MEDIATOR_ADDRESS, homeOptions)
  const foreignMediator = new web3Foreign.eth.Contract(ForeignABI, FOREIGN_MEDIATOR_ADDRESS, foreignOptions)

  console.log('Initializing AMB contracts')
  const foreignAMB = new web3Foreign.eth.Contract(AMBABI, await foreignMediator.methods.bridgeContract().call())
  const homeAMB = new web3Home.eth.Contract(AMBABI, await homeMediator.methods.bridgeContract().call())

  console.log('Fetching fee types')
  const feeManager = new web3Home.eth.Contract(FeeManagerABI, await homeMediator.methods.feeManager().call())
  const homeFeeType = await feeManager.methods.HOME_TO_FOREIGN_FEE().call()
  const foreignFeeType = await feeManager.methods.FOREIGN_TO_HOME_FEE().call()

  console.log('Fetching reward address count')
  const feeEnabled = (await feeManager.methods.rewardAddressCount().call()) > 0

  console.log('Fetching fee values')
  const homeFee = toBN(feeEnabled ? await feeManager.methods.getFee(homeFeeType, ZERO_ADDRESS).call() : 0)
  const foreignFee = toBN(feeEnabled ? await feeManager.methods.getFee(foreignFeeType, ZERO_ADDRESS).call() : 0)
  const oneEthBN = toBN('1000000000000000000')
  console.log(`Home fee: ${homeFee.div(toBN('10000000000000000')).toString(10)}%`)
  console.log(`Foreign fee: ${foreignFee.div(toBN('10000000000000000')).toString(10)}%`)

  console.log('Initializing tokens')
  let homeToken
  let foreignToken
  let homeClaimableToken
  let foreignClaimableToken
  if (HOME_TOKEN_ADDRESS) {
    console.log('Using existing Home token')
    homeToken = new web3Home.eth.Contract(TokenABI, HOME_TOKEN_ADDRESS, homeOptions)
  } else {
    console.log('Deploying test Home token')
    homeToken = await deployToken(web3Home, homeOptions)
  }
  if (FOREIGN_TOKEN_ADDRESS) {
    console.log('Using existing Foreign token')
    foreignToken = new web3Foreign.eth.Contract(TokenABI, FOREIGN_TOKEN_ADDRESS, foreignOptions)
  } else {
    console.log('Deploying test Foreign token')
    foreignToken = await deployToken(web3Foreign, foreignOptions)
  }
  if (HOME_CLAIMABLE_TOKEN_ADDRESS) {
    console.log('Using existing Home claimable token')
    homeClaimableToken = new web3Home.eth.Contract(TokenABI, HOME_CLAIMABLE_TOKEN_ADDRESS, homeOptions)
  } else {
    console.log('Deploying test Home claimable token')
    homeClaimableToken = await deployToken(web3Home, homeOptions)
  }
  if (FOREIGN_CLAIMABLE_TOKEN_ADDRESS) {
    console.log('Using existing Foreign claimable token')
    foreignClaimableToken = new web3Foreign.eth.Contract(TokenABI, FOREIGN_CLAIMABLE_TOKEN_ADDRESS, foreignOptions)
  } else {
    console.log('Deploying test Foreign claimable token')
    foreignClaimableToken = await deployToken(web3Foreign, foreignOptions)
  }

  const homeTokenReceiver = await deployTokenReceiver(web3Home, homeOptions)
  const foreignTokenReceiver = await deployTokenReceiver(web3Foreign, foreignOptions)

  console.log('Fetching block numbers')
  const homeBlockNumber = await web3Home.eth.getBlockNumber()
  const foreignBlockNumber = await web3Foreign.eth.getBlockNumber()

  console.log('Initializing WETH stack')
  const WETH = await deployWETH(web3Foreign, foreignOptions)
  const WETHRouter = await deployWETHRouter(web3Foreign, foreignOptions, foreignMediator, WETH, owner)

  console.log('Initializing Compound environment')
  const compound = {}
  if (
    COMPOUND_FAUCET_PRIVATE_KEY &&
    COMPOUND_COMP_ADDRESS &&
    COMPOUND_TOKEN_ADDRESS &&
    COMPOUND_CTOKEN_ADDRESS &&
    COMPOUND_COMPTROLLER_ADDRESS
  ) {
    compound.faucet = web3Foreign.eth.accounts.wallet.add(COMPOUND_FAUCET_PRIVATE_KEY).address
    const faucetOptions = { ...foreignOptions, from: compound.faucet }
    const comp = new web3Foreign.eth.Contract(TokenABI, COMPOUND_COMP_ADDRESS, faucetOptions)
    const cToken = new web3Foreign.eth.Contract(CTokenABI, COMPOUND_CTOKEN_ADDRESS, faucetOptions)
    const comptroller = new web3Foreign.eth.Contract(ComptrollerABI, COMPOUND_COMPTROLLER_ADDRESS, foreignOptions)
    console.log('Deploy Interest implementation')
    const interestImpl = await deployInterestImpl(web3Foreign, foreignMediator, owner, cToken, foreignOptions)

    compound.token = new web3Foreign.eth.Contract(TokenABI, COMPOUND_TOKEN_ADDRESS, faucetOptions)

    compound.enableInterest = async () => {
      console.log('Enabling interest for the given token')
      await foreignMediator.methods
        .initializeInterest(toAddress(compound.token), toAddress(interestImpl), toWei('1'))
        .send({ from: owner })

      console.log('Investing excess tokens')
      await foreignMediator.methods.invest(toAddress(compound.token)).send()
    }

    compound.disableInterest = async () => {
      console.log('Disabling interest for the given token')
      await foreignMediator.methods.disableInterest(toAddress(compound.token)).send({ from: owner })
    }

    compound.waitForInterest = async () => {
      console.log('Generating some amount of interest to Compound suppliers')
      await cToken.methods.borrow(toWei('10')).send()
      await comptroller.methods.fastForward(200000).send()
      await cToken.methods.repayBorrow(toWei('20')).send()
    }

    compound.acquireInterest = async () => {
      console.log('Paying earned interest in 2 tokens')
      const balance = await compound.token.methods.balanceOf(owner).call()
      const balanceComp = await comp.methods.balanceOf(owner).call()
      await interestImpl.methods.payInterest(toAddress(compound.token)).send()
      await interestImpl.methods.claimCompAndPay([toAddress(cToken)]).send()
      const diff = toBN(await compound.token.methods.balanceOf(owner).call()).sub(toBN(balance))
      const diffComp = toBN(await comp.methods.balanceOf(owner).call()).sub(toBN(balanceComp))
      assert.ok(diff.gtn(0), 'No interest in regular tokens was earned')
      assert.ok(diffComp.gtn(0), 'No interest in COMP tokens was earned')
    }
  }

  return {
    home: {
      web3: web3Home,
      mediator: homeMediator,
      amb: homeAMB,
      token: homeToken,
      tokenReceiver: homeTokenReceiver,
      claimableToken: homeClaimableToken,
      getBridgedToken: makeGetBridgedToken(web3Home, homeMediator, homeOptions),
      waitUntilProcessed: makeWaitUntilProcessed(homeAMB, 'AffirmationCompleted', homeBlockNumber),
      withDisabledExecution: makeWithDisabledExecution(homeMediator, owner),
      checkTransfer: makeCheckTransfer(web3Home),
      reduceByForeignFee: (value) => toBN(value).mul(oneEthBN.sub(foreignFee)).div(oneEthBN).toString(10),
      reduceByHomeFee: (value) => toBN(value).mul(oneEthBN.sub(homeFee)).div(oneEthBN).toString(10),
    },
    foreign: {
      web3: web3Foreign,
      mediator: foreignMediator,
      amb: foreignAMB,
      token: foreignToken,
      tokenReceiver: foreignTokenReceiver,
      claimableToken: foreignClaimableToken,
      getBridgedToken: makeGetBridgedToken(web3Foreign, foreignMediator, foreignOptions),
      waitUntilProcessed: makeWaitUntilProcessed(foreignAMB, 'RelayedMessage', foreignBlockNumber),
      withDisabledExecution: makeWithDisabledExecution(foreignMediator, owner),
      checkTransfer: makeCheckTransfer(web3Foreign),
      compound,
      WETH,
      WETHRouter,
    },
    findMessageId,
    users,
    owner,
  }
}

async function main() {
  const homeProvider = new Web3.providers.HttpProvider(HOME_RPC_URL, { keepAlive: false })
  const web3Home = new Web3(addPendingTxLogger(homeProvider))

  const foreignProvider = new Web3.providers.HttpProvider(FOREIGN_RPC_URL, { keepAlive: false })
  const web3Foreign = new Web3(addPendingTxLogger(foreignProvider))

  console.log('Initializing test environment')
  const env = await createEnv(web3Home, web3Foreign)

  const summary = []
  let failed = 0
  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    console.log(`\nRunning scenario ${i + 1}/${scenarios.length} - ${scenario.name}\n`)
    try {
      if (await scenario.shouldRun(env)) {
        await scenario.run(env)
        console.log('OK')
        summary.push(`${i + 1}) ${scenario.name} - OK`)
      } else {
        console.log('SKIPPED')
        summary.push(`${i + 1}) ${scenario.name} - SKIPPED`)
      }
    } catch (e) {
      console.log('FAILED: ', e.message)
      summary.push(`${i + 1}) ${scenario.name} - FAILED`)
      failed++
    }
  }
  console.log('\nTests summary:')
  console.log(summary.join('\n'))
  process.exit(failed)
}

main()
