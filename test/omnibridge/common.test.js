const HomeOmnibridge = artifacts.require('HomeOmnibridge')
const ForeignOmnibridge = artifacts.require('ForeignOmnibridge')
const EternalStorageProxy = artifacts.require('EternalStorageProxy')
const AMBMock = artifacts.require('AMBMock')
const Sacrifice = artifacts.require('Sacrifice')
const TokenFactory = artifacts.require('TokenFactory')
const MultiTokenForwardingRulesManager = artifacts.require('MultiTokenForwardingRulesManager')
const OmnibridgeFeeManager = artifacts.require('OmnibridgeFeeManager')
const SelectorTokenGasLimitManager = artifacts.require('SelectorTokenGasLimitManager')
const TokenReceiver = artifacts.require('TokenReceiver')
const CompoundInterestERC20 = artifacts.require('CompoundInterestERC20Mock')
const AAVEInterestERC20 = artifacts.require('AAVEInterestERC20Mock')

const { expect } = require('chai')
const { getEvents, ether, expectEventInLogs } = require('../helpers/helpers')
const { ZERO_ADDRESS, toBN, requirePrecompiled } = require('../setup')
const getCompoundContracts = require('../compound/contracts')
const getAAVEContracts = require('../aave/contracts')

const ZERO = toBN(0)
const halfEther = ether('0.5')
const oneEther = ether('1')
const twoEthers = ether('2')
const dailyLimit = ether('2.5')
const maxPerTx = oneEther
const minPerTx = ether('0.01')
const executionDailyLimit = dailyLimit
const executionMaxPerTx = maxPerTx
const exampleMessageId = '0xf308b922ab9f8a7128d9d7bc9bce22cd88b2c05c8213f0e2d8104d78e0a9ecbb'
const otherMessageId = '0x35d3818e50234655f6aebb2a1cfbf30f59568d8a4ec72066fac5a25dbe7b8121'
const otherMessageId2 = '0x9f5102f0a927f5ddd371db9938354105719c4a36d083acea27ab535c1c7849c6'
const failedMessageId = '0x2ebc2ccc755acc8eaf9252e19573af708d644ab63a39619adb080a3500a4ff2e'
const selectors = {
  deployAndHandleBridgedTokens: '0x2ae87cdd',
  deployAndHandleBridgedTokensAndCall: '0xd522cfd7',
  handleBridgedTokens: '0x125e4cfb',
  handleBridgedTokensAndCall: '0xc5345761',
  handleNativeTokens: '0x272255bb',
  handleNativeTokensAndCall: '0x867f7a4d',
  fixFailedMessage: '0x0950d515',
}

function runTests(accounts, isHome) {
  const Mediator = isHome ? HomeOmnibridge : ForeignOmnibridge
  const SUFFIX = ' on Testnet'
  const modifyName = (name) => name + SUFFIX
  const otherSideMediator = '0x1e33FBB006F47F78704c954555a5c52C2A7f409D'
  const otherSideToken1 = '0xAfb77d544aFc1e2aD3dEEAa20F3c80859E7Fc3C9'
  const otherSideToken2 = '0x876bD892b01D1c9696D873f74cbeF8fc9Bfb1142'

  let ERC677BridgeToken
  let PermittableToken

  let contract
  let token
  let ambBridgeContract
  let currentDay
  let tokenImage
  let tokenFactory
  let tokenReceiver
  const owner = accounts[0]
  const user = accounts[1]
  const user2 = accounts[2]
  const value = oneEther

  async function executeMessageCall(messageId, data, options) {
    const opts = options || {}
    await ambBridgeContract.executeMessageCall(
      opts.executor || contract.address,
      opts.messageSender || otherSideMediator,
      data,
      messageId,
      opts.gas || 1000000
    ).should.be.fulfilled
    return ambBridgeContract.messageCallStatus(messageId)
  }

  async function initialize(options) {
    const opts = options || {}
    const args = [
      opts.ambContract || ambBridgeContract.address,
      opts.otherSideMediator || otherSideMediator,
      opts.limits || [dailyLimit, maxPerTx, minPerTx],
      opts.executionLimits || [executionDailyLimit, executionMaxPerTx],
      isHome ? opts.gasLimitManager || ZERO_ADDRESS : opts.requestGasLimit || 1000000,
      opts.owner || owner,
      opts.tokenFactory || tokenFactory.address,
    ]
    if (isHome) {
      args.push(opts.feeManager || ZERO_ADDRESS)
      args.push(opts.forwardingRulesManager || ZERO_ADDRESS)
    }
    return contract.initialize(...args)
  }

  const sendFunctions = [
    async function emptyAlternativeReceiver(value = oneEther) {
      return token.transferAndCall(contract.address, value, '0x', { from: user }).then(() => user)
    },
    async function sameAlternativeReceiver(value = oneEther) {
      return token.transferAndCall(contract.address, value, user, { from: user }).then(() => user)
    },
    async function differentAlternativeReceiver(value = oneEther) {
      return token.transferAndCall(contract.address, value, user2, { from: user }).then(() => user2)
    },
    async function simpleRelayTokens1(value = oneEther) {
      await token.approve(contract.address, value, { from: user }).should.be.fulfilled
      return contract.methods['relayTokens(address,uint256)'](token.address, value, { from: user }).then(() => user)
    },
    async function simpleRelayTokens2(value = oneEther) {
      await token.approve(contract.address, value, { from: user }).should.be.fulfilled
      return contract.methods['relayTokens(address,address,uint256)'](token.address, user, value, { from: user }).then(
        () => user
      )
    },
    async function relayTokensWithAlternativeReceiver(value = oneEther) {
      await token.approve(contract.address, value, { from: user }).should.be.fulfilled
      return contract.methods['relayTokens(address,address,uint256)'](token.address, user2, value, { from: user }).then(
        () => user2
      )
    },
    async function alternativeReceiverWithData(value = oneEther) {
      return token
        .transferAndCall(contract.address, value, `${tokenReceiver.address}1122`, { from: user })
        .then(() => tokenReceiver.address)
    },
    async function relayTokensWithData(value = oneEther) {
      await token.approve(contract.address, value, { from: user }).should.be.fulfilled
      return contract
        .relayTokensAndCall(token.address, tokenReceiver.address, value, '0x1122', { from: user })
        .then(() => tokenReceiver.address)
    },
  ]

  before(async () => {
    ERC677BridgeToken = await requirePrecompiled('ERC677BridgeToken')
    PermittableToken = await requirePrecompiled('PermittableToken')

    tokenImage = await PermittableToken.new('TEST', 'TST', 18, 1337)
    tokenFactory = await TokenFactory.new(owner, tokenImage.address)
  })

  beforeEach(async () => {
    contract = await Mediator.new(SUFFIX)
    ambBridgeContract = await AMBMock.new()
    token = await ERC677BridgeToken.new('TEST', 'TST', 18)
    currentDay = await contract.getCurrentDay()
    tokenReceiver = await TokenReceiver.new()
  })

  describe('getBridgeMode', () => {
    it('should return mediator mode and interface', async function () {
      const bridgeModeHash = '0xb1516c26' // 4 bytes of keccak256('multi-erc-to-erc-amb')
      expect(await contract.getBridgeMode()).to.be.equal(bridgeModeHash)

      const { major, minor, patch } = await contract.getBridgeInterfacesVersion()
      major.should.be.bignumber.gte(ZERO)
      minor.should.be.bignumber.gte(ZERO)
      patch.should.be.bignumber.gte(ZERO)
    })
  })

  describe('claimTokens', () => {
    beforeEach(async () => {
      const storageProxy = await EternalStorageProxy.new()
      await storageProxy.upgradeTo('1', contract.address).should.be.fulfilled
      contract = await Mediator.at(storageProxy.address)
      await initialize().should.be.fulfilled
    })

    it('should work for unknown token', async () => {
      await token.mint(user, oneEther).should.be.fulfilled
      expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)

      await token.transfer(contract.address, oneEther, { from: user }).should.be.fulfilled
      expect(await token.balanceOf(user)).to.be.bignumber.equal(ZERO)
      expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(oneEther)

      await contract.claimTokens(token.address, accounts[3], { from: user }).should.be.rejected
      await contract.claimTokens(token.address, accounts[3], { from: owner }).should.be.fulfilled
      expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
      expect(await token.balanceOf(accounts[3])).to.be.bignumber.equal(oneEther)
    })

    it('should work for native coins', async () => {
      await Sacrifice.new(contract.address, { value: oneEther }).catch(() => {})
      expect(toBN(await web3.eth.getBalance(contract.address))).to.be.bignumber.equal(oneEther)
      const balanceBefore = toBN(await web3.eth.getBalance(accounts[3]))

      await contract.claimTokens(ZERO_ADDRESS, accounts[3], { from: user }).should.be.rejected
      await contract.claimTokens(ZERO_ADDRESS, accounts[3], { from: owner }).should.be.fulfilled

      expect(toBN(await web3.eth.getBalance(contract.address))).to.be.bignumber.equal(ZERO)
      expect(toBN(await web3.eth.getBalance(accounts[3]))).to.be.bignumber.equal(balanceBefore.add(oneEther))
    })

    it('should not work for native bridged token', async () => {
      await token.mint(user, oneEther).should.be.fulfilled
      expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)

      await token.transferAndCall(contract.address, oneEther, '0x', { from: user }).should.be.fulfilled
      expect(await token.balanceOf(user)).to.be.bignumber.equal(ZERO)
      expect(await token.balanceOf(contract.address)).to.be.bignumber.gt(ZERO)

      await contract.claimTokens(token.address, accounts[3], { from: user }).should.be.rejected
      await contract.claimTokens(token.address, accounts[3], { from: owner }).should.be.rejected
    })

    it('should allow owner to claim tokens from token contract', async () => {
      const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
      const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
      expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
      const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

      await token.mint(user, 1).should.be.fulfilled
      await token.transfer(bridgedToken, 1, { from: user }).should.be.fulfilled

      await contract.claimTokensFromTokenContract(bridgedToken, token.address, accounts[3], { from: user }).should.be
        .rejected
      await contract.claimTokensFromTokenContract(bridgedToken, token.address, accounts[3], { from: owner }).should.be
        .fulfilled

      expect(await token.balanceOf(accounts[3])).to.be.bignumber.equal('1')
    })
  })

  describe('initialize', () => {
    it('should initialize parameters', async () => {
      // Given
      expect(await contract.isInitialized()).to.be.equal(false)
      expect(await contract.bridgeContract()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.mediatorContractOnOtherSide()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      expect(await contract.maxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      expect(await contract.minPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      expect(await contract.executionMaxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      if (isHome) {
        expect(await contract.gasLimitManager()).to.be.equal(ZERO_ADDRESS)
      } else {
        expect(await contract.requestGasLimit()).to.be.bignumber.equal(ZERO)
      }
      expect(await contract.owner()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.tokenFactory()).to.be.equal(ZERO_ADDRESS)

      // When
      // not valid bridge address
      await initialize({ ambContract: ZERO_ADDRESS }).should.be.rejected

      // dailyLimit > maxPerTx
      await initialize({ limits: [maxPerTx, maxPerTx, minPerTx] }).should.be.rejected

      // maxPerTx > minPerTx
      await initialize({ limits: [dailyLimit, minPerTx, minPerTx] }).should.be.rejected

      // executionDailyLimit > executionMaxPerTx
      await initialize({ executionLimits: [executionDailyLimit, executionDailyLimit] }).should.be.rejected

      if (isHome) {
        // gas limit manage is not a contract
        await initialize({ gasLimitManager: owner }).should.be.rejected

        // fee manager is not a contract
        await initialize({ feeManager: owner }).should.be.rejected

        // forwarding rules manager is not a contract
        await initialize({ forwardingRulesManager: owner }).should.be.rejected
      } else {
        // maxGasPerTx > bridge maxGasPerTx
        await initialize({ requestGasLimit: ether('1') }).should.be.rejected
      }

      // not valid owner
      await initialize({ owner: ZERO_ADDRESS }).should.be.rejected

      // token factory is not a contract
      await initialize({ tokenFactory: owner }).should.be.rejected

      const { logs } = await initialize().should.be.fulfilled

      // already initialized
      await initialize().should.be.rejected

      // Then
      expect(await contract.isInitialized()).to.be.equal(true)
      expect(await contract.bridgeContract()).to.be.equal(ambBridgeContract.address)
      expect(await contract.mediatorContractOnOtherSide()).to.be.equal(otherSideMediator)
      expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(dailyLimit)
      expect(await contract.maxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(maxPerTx)
      expect(await contract.minPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(minPerTx)
      expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(executionDailyLimit)
      expect(await contract.executionMaxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(executionMaxPerTx)
      if (isHome) {
        expect(await contract.gasLimitManager()).to.be.equal(ZERO_ADDRESS)
      } else {
        expect(await contract.requestGasLimit()).to.be.bignumber.equal('1000000')
      }
      expect(await contract.owner()).to.be.equal(owner)
      expect(await contract.tokenFactory()).to.be.equal(tokenFactory.address)

      expectEventInLogs(logs, 'ExecutionDailyLimitChanged', { token: ZERO_ADDRESS, newLimit: executionDailyLimit })
      expectEventInLogs(logs, 'DailyLimitChanged', { token: ZERO_ADDRESS, newLimit: dailyLimit })
    })
  })

  describe('afterInitialization', () => {
    beforeEach(async () => {
      await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled

      await initialize().should.be.fulfilled

      const initialEvents = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
      expect(initialEvents.length).to.be.equal(0)
    })

    describe('update mediator parameters', () => {
      describe('limits', () => {
        it('should allow to update default daily limits', async () => {
          await contract.setDailyLimit(ZERO_ADDRESS, ether('5'), { from: user }).should.be.rejected
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ether('5'), { from: user }).should.be.rejected
          await contract.setDailyLimit(ZERO_ADDRESS, ether('0.5'), { from: owner }).should.be.rejected
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ether('0.5'), { from: owner }).should.be.rejected
          await contract.setDailyLimit(ZERO_ADDRESS, ether('5'), { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ether('5'), { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ether('5'))
          expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ether('5'))

          await contract.setDailyLimit(ZERO_ADDRESS, ZERO, { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO, { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
          expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
        })

        it('should allow to update default max per tx limits', async () => {
          await contract.setMaxPerTx(ZERO_ADDRESS, ether('1.5'), { from: user }).should.be.rejected
          await contract.setExecutionMaxPerTx(ZERO_ADDRESS, ether('1.5'), { from: user }).should.be.rejected
          await contract.setMaxPerTx(ZERO_ADDRESS, ether('5'), { from: owner }).should.be.rejected
          await contract.setExecutionMaxPerTx(ZERO_ADDRESS, ether('5'), { from: owner }).should.be.rejected
          await contract.setMaxPerTx(ZERO_ADDRESS, ether('0.001'), { from: owner }).should.be.rejected
          await contract.setMaxPerTx(ZERO_ADDRESS, ether('1.5'), { from: owner }).should.be.fulfilled
          await contract.setExecutionMaxPerTx(ZERO_ADDRESS, ether('1.5'), { from: owner }).should.be.fulfilled

          expect(await contract.maxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ether('1.5'))
          expect(await contract.executionMaxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ether('1.5'))

          await contract.setMaxPerTx(ZERO_ADDRESS, ZERO, { from: owner }).should.be.fulfilled
          await contract.setExecutionMaxPerTx(ZERO_ADDRESS, ZERO, { from: owner }).should.be.fulfilled

          expect(await contract.maxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
          expect(await contract.executionMaxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
        })

        it('should allow to update default min per tx limit', async () => {
          await contract.setMinPerTx(ZERO_ADDRESS, ether('0.1'), { from: user }).should.be.rejected
          await contract.setMinPerTx(ZERO_ADDRESS, ZERO, { from: owner }).should.be.rejected
          await contract.setMinPerTx(ZERO_ADDRESS, ether('0.1'), { from: owner }).should.be.fulfilled

          expect(await contract.minPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.1'))

          await contract.setMinPerTx(ZERO_ADDRESS, ZERO, { from: owner }).should.be.rejected
        })

        it('should only allow to update parameters for known tokens', async () => {
          await contract.setDailyLimit(token.address, ether('5'), { from: owner }).should.be.rejected
          await contract.setMaxPerTx(token.address, ether('1.5'), { from: owner }).should.be.rejected
          await contract.setMinPerTx(token.address, ether('0.02'), { from: owner }).should.be.rejected
          await contract.setExecutionDailyLimit(token.address, ether('5'), { from: owner }).should.be.rejected
          await contract.setExecutionMaxPerTx(token.address, ether('1.5'), { from: owner }).should.be.rejected

          await token.transferAndCall(contract.address, value, '0x', { from: user })

          await contract.setDailyLimit(token.address, ether('5'), { from: owner }).should.be.fulfilled
          await contract.setMaxPerTx(token.address, ether('1.5'), { from: owner }).should.be.fulfilled
          await contract.setMinPerTx(token.address, ether('0.02'), { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(token.address, ether('6'), { from: owner }).should.be.fulfilled
          await contract.setExecutionMaxPerTx(token.address, ether('1.6'), { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal(ether('5'))
          expect(await contract.maxPerTx(token.address)).to.be.bignumber.equal(ether('1.5'))
          expect(await contract.minPerTx(token.address)).to.be.bignumber.equal(ether('0.02'))
          expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal(ether('6'))
          expect(await contract.executionMaxPerTx(token.address)).to.be.bignumber.equal(ether('1.6'))

          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

          await contract.setDailyLimit(bridgedToken, ether('5'), { from: owner }).should.be.fulfilled
          await contract.setMaxPerTx(bridgedToken, ether('1.5'), { from: owner }).should.be.fulfilled
          await contract.setMinPerTx(bridgedToken, ether('0.02'), { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(bridgedToken, ether('6'), { from: owner }).should.be.fulfilled
          await contract.setExecutionMaxPerTx(bridgedToken, ether('1.6'), { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(bridgedToken)).to.be.bignumber.equal(ether('5'))
          expect(await contract.maxPerTx(bridgedToken)).to.be.bignumber.equal(ether('1.5'))
          expect(await contract.minPerTx(bridgedToken)).to.be.bignumber.equal(ether('0.02'))
          expect(await contract.executionDailyLimit(bridgedToken)).to.be.bignumber.equal(ether('6'))
          expect(await contract.executionMaxPerTx(bridgedToken)).to.be.bignumber.equal(ether('1.6'))
        })
      })

      describe('token factory', () => {
        it('should allow to change token image', async () => {
          const newTokenImage = await PermittableToken.new('Test', 'TST', 18, 1337)
          await tokenFactory.setTokenImage(owner, { from: owner }).should.be.rejected
          await tokenFactory.setTokenImage(newTokenImage.address, { from: user }).should.be.rejected
          await tokenFactory.setTokenImage(newTokenImage.address, { from: owner }).should.be.fulfilled

          expect(await tokenFactory.tokenImage()).to.be.equal(newTokenImage.address)
        })

        it('should allow to change token factory', async () => {
          const newTokenFactory = await TokenFactory.new(owner, tokenImage.address)
          await contract.setTokenFactory(owner, { from: owner }).should.be.rejected
          await contract.setTokenFactory(newTokenFactory.address, { from: user }).should.be.rejected
          await contract.setTokenFactory(newTokenFactory.address, { from: owner }).should.be.fulfilled

          expect(await contract.tokenFactory()).to.be.equal(newTokenFactory.address)
        })
      })

      if (isHome) {
        describe('gas limit manager', () => {
          let manager
          beforeEach(async () => {
            manager = await SelectorTokenGasLimitManager.new(ambBridgeContract.address, owner, 1000000)
          })

          it('should allow to set new manager', async () => {
            expect(await contract.gasLimitManager()).to.be.equal(ZERO_ADDRESS)

            await contract.setGasLimitManager(manager.address, { from: user }).should.be.rejected
            await contract.setGasLimitManager(manager.address, { from: owner }).should.be.fulfilled

            expect(await contract.gasLimitManager()).to.be.equal(manager.address)
            expect(await manager.owner()).to.be.equal(owner)
            expect(await manager.bridge()).to.be.equal(ambBridgeContract.address)
            expect(await manager.methods['requestGasLimit()']()).to.be.bignumber.equal('1000000')
          })

          it('should allow to set request gas limit for specific selector', async () => {
            await contract.setGasLimitManager(manager.address).should.be.fulfilled

            const method = manager.methods['setRequestGasLimit(bytes4,uint256)']
            await method('0xffffffff', 200000, { from: user }).should.be.rejected
            await method('0xffffffff', 200000, { from: owner }).should.be.fulfilled

            expect(await manager.methods['requestGasLimit(bytes4)']('0xffffffff')).to.be.bignumber.equal('200000')
            expect(await manager.methods['requestGasLimit()']()).to.be.bignumber.equal('1000000')
          })

          it('should use the custom gas limit when bridging tokens', async () => {
            await contract.setGasLimitManager(manager.address).should.be.fulfilled

            await sendFunctions[0](ether('0.01')).should.be.fulfilled
            const reverseData = contract.contract.methods
              .handleNativeTokens(token.address, user, ether('0.01'))
              .encodeABI()
            expect(await executeMessageCall(otherMessageId, reverseData)).to.be.equal(true)
            await sendFunctions[0](ether('0.01')).should.be.fulfilled

            const method = manager.methods['setRequestGasLimit(bytes4,uint256)']
            await method(selectors.handleBridgedTokens, 200000).should.be.fulfilled

            await sendFunctions[0](ether('0.01')).should.be.fulfilled

            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(3)
            expect(events[0].returnValues.gas).to.be.equal('1000000')
            expect(events[1].returnValues.gas).to.be.equal('1000000')
            expect(events[2].returnValues.gas).to.be.equal('200000')
          })

          it('should allow to set request gas limit for specific selector and token', async () => {
            await contract.setGasLimitManager(manager.address).should.be.fulfilled

            const method = manager.methods['setRequestGasLimit(bytes4,address,uint256)']
            await method('0xffffffff', token.address, 200000, { from: user }).should.be.rejected
            await method('0xffffffff', token.address, 200000, { from: owner }).should.be.fulfilled

            expect(
              await manager.methods['requestGasLimit(bytes4,address)']('0xffffffff', token.address)
            ).to.be.bignumber.equal('200000')
            expect(await manager.methods['requestGasLimit(bytes4)']('0xffffffff')).to.be.bignumber.equal('0')
            expect(await manager.methods['requestGasLimit()']()).to.be.bignumber.equal('1000000')
          })

          it('should use the custom gas limit when bridging specific token', async () => {
            await contract.setGasLimitManager(manager.address).should.be.fulfilled

            const method1 = manager.methods['setRequestGasLimit(bytes4,uint256)']
            await method1(selectors.handleBridgedTokens, 100000).should.be.fulfilled

            await sendFunctions[0](ether('0.01')).should.be.fulfilled
            const reverseData = contract.contract.methods
              .handleNativeTokens(token.address, user, ether('0.01'))
              .encodeABI()
            expect(await executeMessageCall(otherMessageId, reverseData)).to.be.equal(true)
            await sendFunctions[0](ether('0.01')).should.be.fulfilled

            const method2 = manager.methods['setRequestGasLimit(bytes4,address,uint256)']
            await method2(selectors.handleBridgedTokens, token.address, 200000).should.be.fulfilled

            await sendFunctions[0](ether('0.01')).should.be.fulfilled

            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(3)
            expect(events[0].returnValues.gas).to.be.equal('1000000')
            expect(events[1].returnValues.gas).to.be.equal('100000')
            expect(events[2].returnValues.gas).to.be.equal('200000')
          })

          describe('common gas limits setters', () => {
            const token = otherSideToken1

            it('should use setCommonRequestGasLimits', async () => {
              const { setCommonRequestGasLimits } = manager
              await setCommonRequestGasLimits([100, 200, 50, 100, 50, 100, 99], { from: user }).should.be.rejected
              await setCommonRequestGasLimits([200, 100, 50, 100, 50, 100, 99], { from: owner }).should.be.rejected
              await setCommonRequestGasLimits([100, 200, 100, 50, 50, 100, 99], { from: owner }).should.be.rejected
              await setCommonRequestGasLimits([100, 200, 50, 100, 100, 50, 99], { from: owner }).should.be.rejected
              await setCommonRequestGasLimits([10, 20, 50, 100, 50, 100, 99], { from: owner }).should.be.rejected
              await setCommonRequestGasLimits([100, 200, 50, 100, 50, 100, 99], { from: owner }).should.be.fulfilled

              const method = manager.methods['requestGasLimit(bytes4)']
              expect(await method(selectors.deployAndHandleBridgedTokens)).to.be.bignumber.equal('100')
              expect(await method(selectors.deployAndHandleBridgedTokensAndCall)).to.be.bignumber.equal('200')
              expect(await method(selectors.handleBridgedTokens)).to.be.bignumber.equal('50')
              expect(await method(selectors.handleBridgedTokensAndCall)).to.be.bignumber.equal('100')
              expect(await method(selectors.handleNativeTokens)).to.be.bignumber.equal('50')
              expect(await method(selectors.handleNativeTokensAndCall)).to.be.bignumber.equal('100')
              expect(await method(selectors.fixFailedMessage)).to.be.bignumber.equal('99')
            })

            it('should use setBridgedTokenRequestGasLimits', async () => {
              await manager.setBridgedTokenRequestGasLimits(token, [100, 200], { from: user }).should.be.rejected
              await manager.setBridgedTokenRequestGasLimits(token, [200, 100], { from: owner }).should.be.rejected
              await manager.setBridgedTokenRequestGasLimits(token, [100, 200], { from: owner }).should.be.fulfilled

              const method = manager.methods['requestGasLimit(bytes4,address)']
              expect(await method(selectors.handleNativeTokens, token)).to.be.bignumber.equal('100')
              expect(await method(selectors.handleNativeTokensAndCall, token)).to.be.bignumber.equal('200')
            })

            it('should use setNativeTokenRequestGasLimits', async () => {
              const { setNativeTokenRequestGasLimits } = manager
              await setNativeTokenRequestGasLimits(token, [100, 200, 50, 100], { from: user }).should.be.rejected
              await setNativeTokenRequestGasLimits(token, [200, 100, 50, 100], { from: owner }).should.be.rejected
              await setNativeTokenRequestGasLimits(token, [100, 200, 100, 50], { from: owner }).should.be.rejected
              await setNativeTokenRequestGasLimits(token, [10, 20, 50, 100], { from: owner }).should.be.rejected
              await setNativeTokenRequestGasLimits(token, [100, 200, 50, 100], { from: owner }).should.be.fulfilled

              const method = manager.methods['requestGasLimit(bytes4,address)']
              expect(await method(selectors.deployAndHandleBridgedTokens, token)).to.be.bignumber.equal('100')
              expect(await method(selectors.deployAndHandleBridgedTokensAndCall, token)).to.be.bignumber.equal('200')
              expect(await method(selectors.handleBridgedTokens, token)).to.be.bignumber.equal('50')
              expect(await method(selectors.handleBridgedTokensAndCall, token)).to.be.bignumber.equal('100')
            })
          })
        })
      } else {
        describe('request gas limit', () => {
          it('should allow to set default gas limit', async () => {
            await contract.setRequestGasLimit(200000, { from: user }).should.be.rejected
            await contract.setRequestGasLimit(200000, { from: owner }).should.be.fulfilled

            expect(await contract.requestGasLimit()).to.be.bignumber.equal('200000')
          })

          it('should use the custom gas limit when bridging tokens', async () => {
            await sendFunctions[0](ether('0.01')).should.be.fulfilled
            await sendFunctions[0](ether('0.01')).should.be.fulfilled

            await contract.setRequestGasLimit(200000).should.be.fulfilled

            await sendFunctions[0](ether('0.01')).should.be.fulfilled

            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(3)
            expect(events[0].returnValues.gas).to.be.equal('1000000')
            expect(events[1].returnValues.gas).to.be.equal('1000000')
            expect(events[2].returnValues.gas).to.be.equal('200000')
          })
        })
      }
    })

    function commonRelayTests() {
      it('should respect global shutdown', async () => {
        await contract.setDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled
        for (const send of sendFunctions) {
          await send().should.be.rejected
        }
        await contract.setDailyLimit(ZERO_ADDRESS, dailyLimit).should.be.fulfilled
        for (const send of sendFunctions) {
          await send(minPerTx).should.be.fulfilled
        }
      })

      it('should respect limits', async () => {
        for (const send of sendFunctions) {
          await send(ether('0.001')).should.be.rejected
          await send(ether('1.001')).should.be.rejected
        }

        const simpleSend = sendFunctions[0]
        await simpleSend().should.be.fulfilled
        await simpleSend().should.be.fulfilled

        expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(halfEther)

        for (const send of sendFunctions) {
          await send(ether('1.001')).should.be.rejected
          await send(ether('0.8')).should.be.rejected
          await send(minPerTx).should.be.fulfilled
        }
      })
    }

    describe('native tokens', () => {
      describe('initialization', () => {
        for (const decimals of [3, 18, 20]) {
          it(`should initialize limits according to decimals = ${decimals}`, async () => {
            const f1 = toBN(`1${'0'.repeat(decimals)}`)
            const f2 = toBN('1000000000000000000')

            token = await ERC677BridgeToken.new('TEST', 'TST', decimals)
            await token.mint(user, value.mul(f1).div(f2)).should.be.fulfilled
            await token.transferAndCall(contract.address, value.mul(f1).div(f2), '0x', { from: user }).should.be
              .fulfilled

            expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal(dailyLimit.mul(f1).div(f2))
            expect(await contract.maxPerTx(token.address)).to.be.bignumber.equal(maxPerTx.mul(f1).div(f2))
            expect(await contract.minPerTx(token.address)).to.be.bignumber.equal(minPerTx.mul(f1).div(f2))
            expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal(
              executionDailyLimit.mul(f1).div(f2)
            )
            expect(await contract.executionMaxPerTx(token.address)).to.be.bignumber.equal(
              executionMaxPerTx.mul(f1).div(f2)
            )
          })
        }

        it(`should initialize limits according to decimals = 0`, async () => {
          token = await ERC677BridgeToken.new('TEST', 'TST', 0)
          await token.mint(user, '1').should.be.fulfilled
          await token.transferAndCall(contract.address, '1', '0x', { from: user }).should.be.fulfilled

          expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal('10000')
          expect(await contract.maxPerTx(token.address)).to.be.bignumber.equal('100')
          expect(await contract.minPerTx(token.address)).to.be.bignumber.equal('1')
          expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal('10000')
          expect(await contract.executionMaxPerTx(token.address)).to.be.bignumber.equal('100')
        })
      })

      describe('tokens relay', () => {
        for (const send of sendFunctions) {
          it(`should make calls to deployAndHandleBridgedTokens and handleBridgedTokens using ${send.name}`, async () => {
            const receiver = await send().should.be.fulfilled

            expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(value)
            expect(await contract.isRegisteredAsNativeToken(token.address)).to.be.equal(true)

            await send(halfEther).should.be.fulfilled

            const reverseData = contract.contract.methods.handleNativeTokens(token.address, user, halfEther).encodeABI()

            expect(await contract.isBridgedTokenDeployAcknowledged(token.address)).to.be.equal(false)
            expect(await executeMessageCall(otherMessageId, reverseData)).to.be.equal(true)
            expect(await contract.isBridgedTokenDeployAcknowledged(token.address)).to.be.equal(true)

            await send(halfEther).should.be.fulfilled

            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(3)

            for (let i = 0; i < 2; i++) {
              const { data, dataType, executor } = events[i].returnValues
              expect(executor).to.be.equal(otherSideMediator)
              let args
              if (receiver === tokenReceiver.address) {
                expect(data.slice(0, 10)).to.be.equal(selectors.deployAndHandleBridgedTokensAndCall)
                args = web3.eth.abi.decodeParameters(
                  ['address', 'string', 'string', 'uint8', 'address', 'uint256', 'bytes'],
                  data.slice(10)
                )
                expect(args[6]).to.be.equal('0x1122')
              } else {
                expect(data.slice(0, 10)).to.be.equal(selectors.deployAndHandleBridgedTokens)
                args = web3.eth.abi.decodeParameters(
                  ['address', 'string', 'string', 'uint8', 'address', 'uint256'],
                  data.slice(10)
                )
              }
              expect(args[0]).to.be.equal(token.address)
              expect(args[1]).to.be.equal(await token.name())
              expect(args[2]).to.be.equal(await token.symbol())
              expect(args[3]).to.be.equal((await token.decimals()).toString())
              expect(args[4]).to.be.equal(receiver)
              expect(args[5]).to.be.equal((i === 0 ? value : halfEther).toString())
              expect(dataType).to.be.equal('0')
            }

            const { data, dataType } = events[2].returnValues
            let args
            if (receiver === tokenReceiver.address) {
              expect(data.slice(0, 10)).to.be.equal(selectors.handleBridgedTokensAndCall)
              args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256', 'bytes'], data.slice(10))
              expect(args[3]).to.be.equal('0x1122')
            } else {
              expect(data.slice(0, 10)).to.be.equal(selectors.handleBridgedTokens)
              args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data.slice(10))
            }
            expect(args[0]).to.be.equal(token.address)
            expect(args[1]).to.be.equal(receiver)
            expect(args[2]).to.be.equal(halfEther.toString())
            expect(dataType).to.be.equal('0')

            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)
            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ether('1.5'))
            expect(await contract.isTokenRegistered(token.address)).to.be.equal(true)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('1.5'))
            expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(halfEther)

            const depositEvents = await getEvents(contract, { event: 'TokensBridgingInitiated' })
            expect(depositEvents.length).to.be.equal(3)
            expect(depositEvents[0].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[0].returnValues.sender).to.be.equal(user)
            expect(depositEvents[0].returnValues.value).to.be.equal(value.toString())
            expect(depositEvents[0].returnValues.messageId).to.include('0x11223344')
            expect(depositEvents[1].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[1].returnValues.sender).to.be.equal(user)
            expect(depositEvents[1].returnValues.value).to.be.equal(halfEther.toString())
            expect(depositEvents[1].returnValues.messageId).to.include('0x11223344')
            expect(depositEvents[2].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[2].returnValues.sender).to.be.equal(user)
            expect(depositEvents[2].returnValues.value).to.be.equal(halfEther.toString())
            expect(depositEvents[2].returnValues.messageId).to.include('0x11223344')
          })
        }

        it('should allow to use relayTokensAndCall', async () => {
          await sendFunctions[0]().should.be.fulfilled

          const reverseData = contract.contract.methods.handleNativeTokens(token.address, user, halfEther).encodeABI()

          expect(await executeMessageCall(otherMessageId, reverseData)).to.be.equal(true)

          let events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
          expect(events.length).to.be.equal(1)

          await token.approve(contract.address, value, { from: user }).should.be.fulfilled
          await contract.relayTokensAndCall(token.address, otherSideToken1, value, '0x1122', { from: user }).should.be
            .fulfilled

          events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
          expect(events.length).to.be.equal(2)
          const { data, dataType } = events[1].returnValues
          expect(data.slice(0, 10)).to.be.equal(selectors.handleBridgedTokensAndCall)
          const args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256', 'bytes'], data.slice(10))
          expect(args[0]).to.be.equal(token.address)
          expect(args[1]).to.be.equal(otherSideToken1)
          expect(args[2]).to.be.equal(value.toString())
          expect(args[3]).to.be.equal('0x1122')

          expect(dataType).to.be.equal('0')
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)
          expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ether('1.5'))
          expect(await contract.isTokenRegistered(token.address)).to.be.equal(true)
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('1.5'))
          expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(halfEther)

          const depositEvents = await getEvents(contract, { event: 'TokensBridgingInitiated' })
          expect(depositEvents.length).to.be.equal(2)
          expect(depositEvents[1].returnValues.token).to.be.equal(token.address)
          expect(depositEvents[1].returnValues.sender).to.be.equal(user)
          expect(depositEvents[1].returnValues.value).to.be.equal(value.toString())
          expect(depositEvents[1].returnValues.messageId).to.include('0x11223344')
        })

        commonRelayTests()

        describe('fixFailedMessage', () => {
          for (const send of sendFunctions) {
            it(`should fix tokens locked via ${send.name}`, async () => {
              // User transfer tokens twice
              await send(halfEther)
              await send(value)

              const reverseData = contract.contract.methods.handleNativeTokens(token.address, user, value).encodeABI()

              expect(await executeMessageCall(otherMessageId2, reverseData)).to.be.equal(true)

              await send(halfEther)

              expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(oneEther)

              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('9'))

              const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
              expect(events.length).to.be.equal(3)
              const transferMessageId1 = events[0].returnValues.messageId
              const transferMessageId2 = events[2].returnValues.messageId
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId2)).to.be.equal(false)

              await contract.fixFailedMessage(transferMessageId2, { from: user }).should.be.rejected
              await contract.fixFailedMessage(transferMessageId2, { from: owner }).should.be.rejected
              const fixData1 = await contract.contract.methods.fixFailedMessage(transferMessageId1).encodeABI()
              const fixData2 = await contract.contract.methods.fixFailedMessage(transferMessageId2).encodeABI()

              // Should be called by mediator from other side so it will fail
              expect(await executeMessageCall(failedMessageId, fixData2, { messageSender: owner })).to.be.equal(false)

              expect(await ambBridgeContract.messageCallStatus(failedMessageId)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId2)).to.be.equal(false)

              expect(await executeMessageCall(exampleMessageId, fixData2)).to.be.equal(true)
              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('9.5'))
              expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(halfEther)
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId2)).to.be.equal(true)
              expect(await contract.minPerTx(token.address)).to.be.bignumber.gt('0')

              expect(await executeMessageCall(otherMessageId, fixData1)).to.be.equal(true)
              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('10'))
              expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ZERO)
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(true)

              const event = await getEvents(contract, { event: 'FailedMessageFixed' })
              expect(event.length).to.be.equal(2)
              expect(event[0].returnValues.messageId).to.be.equal(transferMessageId2)
              expect(event[0].returnValues.token).to.be.equal(token.address)
              expect(event[0].returnValues.recipient).to.be.equal(user)
              expect(event[0].returnValues.value).to.be.equal(halfEther.toString())
              expect(event[1].returnValues.messageId).to.be.equal(transferMessageId1)
              expect(event[1].returnValues.token).to.be.equal(token.address)
              expect(event[1].returnValues.recipient).to.be.equal(user)
              expect(event[1].returnValues.value).to.be.equal(halfEther.toString())

              expect(await executeMessageCall(failedMessageId, fixData1)).to.be.equal(false)
              expect(await executeMessageCall(failedMessageId, fixData2)).to.be.equal(false)
            })
          }
        })

        describe('fixMediatorBalance', () => {
          beforeEach(async () => {
            const storageProxy = await EternalStorageProxy.new()
            await storageProxy.upgradeTo('1', contract.address).should.be.fulfilled
            contract = await Mediator.at(storageProxy.address)

            await token.mint(user, twoEthers, { from: owner }).should.be.fulfilled
            await token.mint(contract.address, twoEthers, { from: owner }).should.be.fulfilled

            await initialize().should.be.fulfilled

            await token.transferAndCall(contract.address, oneEther, '0x', { from: user }).should.be.fulfilled

            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(oneEther)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('3'))
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(oneEther)
            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(1)
          })

          it('should allow to fix extra mediator balance', async () => {
            await contract.setDailyLimit(token.address, ether('5')).should.be.fulfilled
            await contract.setMaxPerTx(token.address, ether('2')).should.be.fulfilled

            await contract.fixMediatorBalance(token.address, owner, { from: user }).should.be.rejected
            await contract.fixMediatorBalance(ZERO_ADDRESS, owner, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, ZERO_ADDRESS, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.fulfilled
            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.rejected

            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ether('3'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('3'))
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ether('3'))
            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data, dataType, executor } = events[1].returnValues
            expect(data.slice(0, 10)).to.be.equal(selectors.deployAndHandleBridgedTokens)
            expect(executor).to.be.equal(otherSideMediator)
            expect(dataType).to.be.bignumber.equal('0')
          })

          it('should use different methods on the other side', async () => {
            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.fulfilled

            const reverseData = contract.contract.methods.handleNativeTokens(token.address, user, halfEther).encodeABI()

            expect(await executeMessageCall(otherMessageId, reverseData)).to.be.equal(true)

            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.fulfilled

            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(3)
            expect(events[1].returnValues.data.slice(0, 10)).to.be.equal(selectors.deployAndHandleBridgedTokens)
            expect(events[2].returnValues.data.slice(0, 10)).to.be.equal(selectors.handleBridgedTokens)
          })

          it('should allow to fix extra mediator balance with respect to limits', async () => {
            await contract.fixMediatorBalance(token.address, owner, { from: user }).should.be.rejected
            await contract.fixMediatorBalance(ZERO_ADDRESS, owner, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, ZERO_ADDRESS, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.fulfilled

            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ether('2'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('3'))
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ether('2'))

            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.fulfilled

            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ether('2.5'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('3'))
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ether('2.5'))
            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(3)

            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.rejected
            await contract.setDailyLimit(token.address, ether('1.5')).should.be.fulfilled
            await contract.fixMediatorBalance(token.address, owner, { from: owner }).should.be.rejected
          })
        })
      })

      describe('handleNativeTokens', () => {
        it('should unlock tokens on message from amb', async () => {
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(twoEthers)
          expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(twoEthers)

          // can't be called by user
          await contract.handleNativeTokens(token.address, user, value, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.handleNativeTokens(token.address, user, value, { from: owner }).should.be.rejected

          const data = await contract.contract.methods
            .handleNativeTokens(token.address, user, value.toString())
            .encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(token.address, currentDay)).to.be.bignumber.equal(value)
          expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(value)
          expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('9'))
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(value)
          expect(await contract.isBridgedTokenDeployAcknowledged(token.address)).to.be.equal(true)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(1)
          expect(event[0].returnValues.token).to.be.equal(token.address)
          expect(event[0].returnValues.recipient).to.be.equal(user)
          expect(event[0].returnValues.value).to.be.equal(value.toString())
          expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should not allow to use unregistered tokens', async () => {
          const otherToken = await ERC677BridgeToken.new('Test', 'TST', 18)
          await otherToken.mint(contract.address, value)
          const data = await contract.contract.methods
            .handleNativeTokens(otherToken.address, user, value.toString())
            .encodeABI()

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          const data = await contract.contract.methods
            .handleNativeTokens(token.address, user, value.toString())
            .encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, executionDailyLimit).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('handleNativeTokensAndCall', () => {
        it('should unlock tokens on message from amb', async () => {
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(twoEthers)
          expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(twoEthers)

          const args = [token.address, tokenReceiver.address, value, '0x5566']
          // can't be called by user
          await contract.handleNativeTokensAndCall(...args, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.handleNativeTokensAndCall(...args, { from: owner }).should.be.rejected

          const data = await contract.contract.methods.handleNativeTokensAndCall(...args).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(token.address, currentDay)).to.be.bignumber.equal(value)
          expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(value)
          expect(await token.balanceOf(tokenReceiver.address)).to.be.bignumber.equal(ether('1'))
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(value)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(1)
          expect(event[0].returnValues.token).to.be.equal(token.address)
          expect(event[0].returnValues.recipient).to.be.equal(tokenReceiver.address)
          expect(event[0].returnValues.value).to.be.equal(value.toString())
          expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)

          expect(await tokenReceiver.data()).to.be.equal('0x5566')
        })

        it('should not allow to use unregistered tokens', async () => {
          const otherToken = await ERC677BridgeToken.new('Test', 'TST', 18)
          await otherToken.mint(contract.address, value)
          const data = await contract.contract.methods
            .handleNativeTokens(otherToken.address, user, value.toString())
            .encodeABI()

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          const data = await contract.contract.methods
            .handleNativeTokens(token.address, user, value.toString())
            .encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, executionDailyLimit).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('requestFailedMessageFix', () => {
        let msgData
        beforeEach(async () => {
          msgData = await contract.contract.methods
            .handleNativeTokens(token.address, user, value.toString())
            .encodeABI()
        })
        it('should allow to request a failed message fix', async () => {
          expect(await executeMessageCall(failedMessageId, msgData)).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.fulfilled

          const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
          expect(events.length).to.be.equal(1)
          const { data } = events[0].returnValues
          expect(data.slice(0, 10)).to.be.equal(selectors.fixFailedMessage)
          const args = web3.eth.abi.decodeParameters(['bytes32'], data.slice(10))
          expect(args[0]).to.be.equal(failedMessageId)
        })

        it('should be a failed transaction', async () => {
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          expect(await executeMessageCall(exampleMessageId, msgData)).to.be.equal(true)

          await contract.requestFailedMessageFix(exampleMessageId).should.be.rejected
        })

        it('should be the receiver of the failed transaction', async () => {
          expect(
            await executeMessageCall(failedMessageId, msgData, { executor: ambBridgeContract.address })
          ).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.rejected
        })

        it('message sender should be mediator from other side', async () => {
          expect(await executeMessageCall(failedMessageId, msgData, { messageSender: owner })).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.rejected
        })

        it('should allow to request a fix multiple times', async () => {
          expect(await executeMessageCall(failedMessageId, msgData)).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.fulfilled
          await contract.requestFailedMessageFix(failedMessageId).should.be.fulfilled

          const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
          expect(events.length).to.be.equal(2)
          expect(events[0].returnValues.data.slice(0, 10)).to.be.equal(selectors.fixFailedMessage)
          expect(events[1].returnValues.data.slice(0, 10)).to.be.equal(selectors.fixFailedMessage)
        })
      })
    })

    describe('bridged tokens', () => {
      describe('tokens relay', () => {
        beforeEach(async () => {
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ether('10')).should.be.fulfilled
          await contract.setExecutionMaxPerTx(ZERO_ADDRESS, ether('5')).should.be.fulfilled
          const args = [otherSideToken1, 'Test', 'TST', 18, user, ether('5')]
          const deployData = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
          token = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))
        })

        for (const send of sendFunctions) {
          it(`should make calls to handleNativeTokens using ${send.name} for bridged token`, async () => {
            const receiver = await send().should.be.fulfilled

            let events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(1)
            const { data, dataType, executor } = events[0].returnValues
            let args
            if (receiver === tokenReceiver.address) {
              expect(data.slice(0, 10)).to.be.equal(selectors.handleNativeTokensAndCall)
              args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256', 'bytes'], data.slice(10))
              expect(args[3]).to.be.equal('0x1122')
            } else {
              expect(data.slice(0, 10)).to.be.equal(selectors.handleNativeTokens)
              args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data.slice(10))
            }
            expect(executor).to.be.equal(otherSideMediator)
            expect(args[0]).to.be.equal(otherSideToken1)
            expect(args[1]).to.be.equal(receiver)
            expect(args[2]).to.be.equal(value.toString())
            expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(value)

            await send().should.be.fulfilled

            events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data: data2, dataType: dataType2 } = events[1].returnValues
            let args2
            if (receiver === tokenReceiver.address) {
              expect(data2.slice(0, 10)).to.be.equal(selectors.handleNativeTokensAndCall)
              args2 = web3.eth.abi.decodeParameters(['address', 'address', 'uint256', 'bytes'], data2.slice(10))
              expect(args2[3]).to.be.equal('0x1122')
            } else {
              expect(data2.slice(0, 10)).to.be.equal(selectors.handleNativeTokens)
              args2 = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data2.slice(10))
            }
            expect(args2[0]).to.be.equal(otherSideToken1)
            expect(args2[1]).to.be.equal(receiver)
            expect(args2[2]).to.be.equal(value.toString())

            expect(dataType).to.be.equal('0')
            expect(dataType2).to.be.equal('0')
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)
            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ZERO)
            expect(await contract.isTokenRegistered(token.address)).to.be.equal(true)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(halfEther)

            const depositEvents = await getEvents(contract, { event: 'TokensBridgingInitiated' })
            expect(depositEvents.length).to.be.equal(2)
            expect(depositEvents[0].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[0].returnValues.sender).to.be.equal(user)
            expect(depositEvents[0].returnValues.value).to.be.equal(value.toString())
            expect(depositEvents[0].returnValues.messageId).to.include('0x11223344')
            expect(depositEvents[1].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[1].returnValues.sender).to.be.equal(user)
            expect(depositEvents[1].returnValues.value).to.be.equal(value.toString())
            expect(depositEvents[1].returnValues.messageId).to.include('0x11223344')
          })
        }

        commonRelayTests()

        describe('fixFailedMessage', () => {
          for (const send of sendFunctions) {
            it(`should fix tokens locked via ${send.name}`, async () => {
              // User transfer tokens
              await send()

              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('4'))

              const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
              expect(events.length).to.be.equal(1)
              const transferMessageId = events[0].returnValues.messageId
              expect(await contract.messageFixed(transferMessageId)).to.be.equal(false)

              await contract.fixFailedMessage(transferMessageId, { from: user }).should.be.rejected
              await contract.fixFailedMessage(transferMessageId, { from: owner }).should.be.rejected
              const fixData = await contract.contract.methods.fixFailedMessage(transferMessageId).encodeABI()

              // Should be called by mediator from other side so it will fail
              expect(await executeMessageCall(failedMessageId, fixData, { messageSender: owner })).to.be.equal(false)

              expect(await ambBridgeContract.messageCallStatus(failedMessageId)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId)).to.be.equal(false)

              expect(await executeMessageCall(exampleMessageId, fixData)).to.be.equal(true)
              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('5'))
              expect(await contract.messageFixed(transferMessageId)).to.be.equal(true)
              expect(await contract.minPerTx(token.address)).to.be.bignumber.gt('0')

              const event = await getEvents(contract, { event: 'FailedMessageFixed' })
              expect(event.length).to.be.equal(1)
              expect(event[0].returnValues.messageId).to.be.equal(transferMessageId)
              expect(event[0].returnValues.token).to.be.equal(token.address)
              expect(event[0].returnValues.recipient).to.be.equal(user)
              expect(event[0].returnValues.value).to.be.equal(value.toString())

              expect(await executeMessageCall(failedMessageId, fixData)).to.be.equal(false)
            })
          }
        })
      })

      describe('deployAndHandleBridgedTokens', () => {
        it('should deploy contract and mint tokens on first message from amb', async () => {
          // can't be called by user
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          await contract.deployAndHandleBridgedTokens(...args, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.deployAndHandleBridgedTokens(...args, { from: owner }).should.be.rejected

          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const { nativeToken, bridgedToken } = events[0].returnValues
          expect(nativeToken).to.be.equal(otherSideToken1)
          const deployedToken = await PermittableToken.at(bridgedToken)

          expect(await deployedToken.name()).to.be.equal(modifyName('Test'))
          expect(await deployedToken.symbol()).to.be.equal('TST')
          expect(await deployedToken.decimals()).to.be.bignumber.equal('18')
          expect(await contract.nativeTokenAddress(bridgedToken)).to.be.equal(nativeToken)
          expect(await contract.bridgedTokenAddress(nativeToken)).to.be.equal(bridgedToken)
          if (isHome) {
            expect(await contract.foreignTokenAddress(bridgedToken)).to.be.equal(nativeToken)
            expect(await contract.homeTokenAddress(nativeToken)).to.be.equal(bridgedToken)
          }
          expect(await contract.isRegisteredAsNativeToken(bridgedToken)).to.be.equal(false)
          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(value)
          expect(await contract.mediatorBalance(deployedToken.address)).to.be.bignumber.equal(ZERO)
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal(value)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(1)
          expect(event[0].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[0].returnValues.recipient).to.be.equal(user)
          expect(event[0].returnValues.value).to.be.equal(value.toString())
          expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should do not deploy new contract if token is already deployed', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await executeMessageCall(otherSideToken1, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(2)
        })

        it('should modify use symbol instead of name if empty', async () => {
          const args = [otherSideToken1, '', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const deployedToken = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))
          expect(await deployedToken.name()).to.be.equal(modifyName('TST'))
          expect(await deployedToken.symbol()).to.be.equal('TST')
          expect(await deployedToken.decimals()).to.be.bignumber.equal('18')
        })

        it('should modify use name instead of symbol if empty', async () => {
          const args = [otherSideToken1, 'Test', '', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const deployedToken = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))
          expect(await deployedToken.name()).to.be.equal(modifyName('Test'))
          expect(await deployedToken.symbol()).to.be.equal('Test')
          expect(await deployedToken.decimals()).to.be.bignumber.equal('18')
        })

        for (const decimals of [3, 18, 20]) {
          it(`should deploy token with different decimals = ${decimals}`, async () => {
            const f1 = toBN(`1${'0'.repeat(decimals)}`)
            const f2 = toBN('1000000000000000000')

            const args = [otherSideToken1, 'Test', 'TST', decimals, user, value.mul(f1).div(f2)]
            const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

            expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

            const deployedTokenAddr = await contract.bridgedTokenAddress(otherSideToken1)
            const deployedToken = await PermittableToken.at(deployedTokenAddr)

            expect(await deployedToken.decimals()).to.be.bignumber.equal(decimals.toString())

            expect(await contract.dailyLimit(deployedTokenAddr)).to.be.bignumber.equal(dailyLimit.mul(f1).div(f2))
            expect(await contract.maxPerTx(deployedTokenAddr)).to.be.bignumber.equal(maxPerTx.mul(f1).div(f2))
            expect(await contract.minPerTx(deployedTokenAddr)).to.be.bignumber.equal(minPerTx.mul(f1).div(f2))
            expect(await contract.executionDailyLimit(deployedTokenAddr)).to.be.bignumber.equal(
              executionDailyLimit.mul(f1).div(f2)
            )
            expect(await contract.executionMaxPerTx(deployedTokenAddr)).to.be.bignumber.equal(
              executionMaxPerTx.mul(f1).div(f2)
            )
          })
        }

        it('should deploy token with different decimals = 0', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 0, user, 1]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const deployedTokenAddr = await contract.bridgedTokenAddress(otherSideToken1)
          const deployedToken = await PermittableToken.at(deployedTokenAddr)

          expect(await deployedToken.decimals()).to.be.bignumber.equal('0')
          expect(await contract.dailyLimit(deployedTokenAddr)).to.be.bignumber.equal('10000')
          expect(await contract.maxPerTx(deployedTokenAddr)).to.be.bignumber.equal('100')
          expect(await contract.minPerTx(deployedTokenAddr)).to.be.bignumber.equal('1')
          expect(await contract.executionDailyLimit(deployedTokenAddr)).to.be.bignumber.equal('10000')
          expect(await contract.executionMaxPerTx(deployedTokenAddr)).to.be.bignumber.equal('100')
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, executionDailyLimit).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('deployAndHandleBridgedTokensAndCall', () => {
        it('should deploy contract and mint tokens on first message from amb', async () => {
          // can't be called by user
          const args = [otherSideToken1, 'Test', 'TST', 18, tokenReceiver.address, value, '0x5566']
          await contract.deployAndHandleBridgedTokensAndCall(...args, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.deployAndHandleBridgedTokensAndCall(...args, { from: owner }).should.be.rejected

          const data = contract.contract.methods.deployAndHandleBridgedTokensAndCall(...args).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const { nativeToken, bridgedToken } = events[0].returnValues
          expect(nativeToken).to.be.equal(otherSideToken1)
          const deployedToken = await PermittableToken.at(bridgedToken)

          expect(await deployedToken.name()).to.be.equal(modifyName('Test'))
          expect(await deployedToken.symbol()).to.be.equal('TST')
          expect(await deployedToken.decimals()).to.be.bignumber.equal('18')
          expect(await contract.nativeTokenAddress(bridgedToken)).to.be.equal(nativeToken)
          expect(await contract.bridgedTokenAddress(nativeToken)).to.be.equal(bridgedToken)
          if (isHome) {
            expect(await contract.foreignTokenAddress(bridgedToken)).to.be.equal(nativeToken)
            expect(await contract.homeTokenAddress(nativeToken)).to.be.equal(bridgedToken)
          }
          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(value)
          expect(await contract.mediatorBalance(deployedToken.address)).to.be.bignumber.equal(ZERO)
          expect(await deployedToken.balanceOf(tokenReceiver.address)).to.be.bignumber.equal(value)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(1)
          expect(event[0].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[0].returnValues.recipient).to.be.equal(tokenReceiver.address)
          expect(event[0].returnValues.value).to.be.equal(value.toString())
          expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)

          expect(await tokenReceiver.data()).to.be.equal('0x5566')
        })
      })

      describe('handleBridgedTokens', () => {
        let deployedToken
        beforeEach(async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const { nativeToken, bridgedToken } = events[0].returnValues
          expect(nativeToken).to.be.equal(otherSideToken1)
          deployedToken = await PermittableToken.at(bridgedToken)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(value)
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal(value)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
        })

        it('should mint existing tokens on repeated messages from amb', async () => {
          // can't be called by user
          await contract.handleBridgedTokens(otherSideToken1, user, value, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.handleBridgedTokens(otherSideToken1, user, value, { from: owner }).should.be.rejected

          const data = contract.contract.methods.handleBridgedTokens(otherSideToken1, user, value).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(twoEthers)
          expect(await contract.mediatorBalance(deployedToken.address)).to.be.bignumber.equal(ZERO)
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal(twoEthers)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(2)
          expect(event[1].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[1].returnValues.recipient).to.be.equal(user)
          expect(event[1].returnValues.value).to.be.equal(value.toString())
          expect(event[1].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should not allow to process unknown tokens', async () => {
          const data = contract.contract.methods.handleBridgedTokens(otherSideToken2, user, value).encodeABI()

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          const data = contract.contract.methods.handleBridgedTokens(otherSideToken1, user, value).encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, executionDailyLimit).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('handleBridgedTokensAndCall', () => {
        let deployedToken
        beforeEach(async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const { nativeToken, bridgedToken } = events[0].returnValues
          expect(nativeToken).to.be.equal(otherSideToken1)
          deployedToken = await PermittableToken.at(bridgedToken)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(value)
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal(value)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
        })

        it('should mint existing tokens and call onTokenTransfer', async () => {
          const args = [otherSideToken1, tokenReceiver.address, value, '0x1122']
          // can't be called by user
          await contract.handleBridgedTokensAndCall(...args, { from: user }).should.be.rejected
          // can't be called by owner
          await contract.handleBridgedTokensAndCall(...args, { from: owner }).should.be.rejected

          const data = contract.contract.methods.handleBridgedTokensAndCall(...args).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(twoEthers)
          expect(await contract.mediatorBalance(deployedToken.address)).to.be.bignumber.equal(ZERO)
          expect(await deployedToken.balanceOf(tokenReceiver.address)).to.be.bignumber.equal(oneEther)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
          expect(await tokenReceiver.token()).to.be.equal(deployedToken.address)
          expect(await tokenReceiver.from()).to.be.equal(contract.address)
          expect(await tokenReceiver.value()).to.be.bignumber.equal(value)
          expect(await tokenReceiver.data()).to.be.equal('0x1122')

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(2)
          expect(event[1].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[1].returnValues.recipient).to.be.equal(tokenReceiver.address)
          expect(event[1].returnValues.value).to.be.equal(value.toString())
          expect(event[1].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should mint existing tokens and handle missing onTokenTransfer', async () => {
          const args = [otherSideToken1, user, value, '0x1122']
          // can't be called by user
          await contract.handleBridgedTokensAndCall(...args, { from: user }).should.be.rejected
          // can't be called by owner
          await contract.handleBridgedTokensAndCall(...args, { from: owner }).should.be.rejected

          const data = contract.contract.methods.handleBridgedTokensAndCall(...args).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal(twoEthers)
          expect(await contract.mediatorBalance(deployedToken.address)).to.be.bignumber.equal(ZERO)
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal(twoEthers)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(2)
          expect(event[1].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[1].returnValues.recipient).to.be.equal(user)
          expect(event[1].returnValues.value).to.be.equal(value.toString())
          expect(event[1].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should not allow to process unknown tokens', async () => {
          const data = contract.contract.methods
            .handleBridgedTokensAndCall(otherSideToken2, user, value, '0x00')
            .encodeABI()

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          const data = contract.contract.methods
            .handleBridgedTokensAndCall(otherSideToken1, user, value, '0x00')
            .encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, executionDailyLimit).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('requestFailedMessageFix', () => {
        let msgData
        beforeEach(() => {
          msgData = contract.contract.methods
            .deployAndHandleBridgedTokens(otherSideToken1, 'Test', 'TST', 18, user, value.toString())
            .encodeABI()
        })
        it('should allow to request a failed message fix', async () => {
          expect(await executeMessageCall(failedMessageId, msgData, { gas: 100 })).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.fulfilled

          const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
          expect(events.length).to.be.equal(1)
          const { data } = events[0].returnValues
          expect(data.slice(0, 10)).to.be.equal(selectors.fixFailedMessage)
          const args = web3.eth.abi.decodeParameters(['bytes32'], data.slice(10))
          expect(args[0]).to.be.equal(failedMessageId)
        })

        it('should be a failed transaction', async () => {
          expect(await executeMessageCall(exampleMessageId, msgData)).to.be.equal(true)

          await contract.requestFailedMessageFix(exampleMessageId).should.be.rejected
        })

        it('should be the receiver of the failed transaction', async () => {
          expect(
            await executeMessageCall(failedMessageId, msgData, { executor: ambBridgeContract.address })
          ).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.rejected
        })

        it('message sender should be mediator from other side', async () => {
          expect(await executeMessageCall(failedMessageId, msgData, { messageSender: owner })).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.rejected
        })

        it('should allow to request a fix multiple times', async () => {
          expect(await executeMessageCall(failedMessageId, msgData, { gas: 100 })).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.fulfilled
          await contract.requestFailedMessageFix(failedMessageId).should.be.fulfilled

          const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
          expect(events.length).to.be.equal(2)
          expect(events[0].returnValues.data.slice(0, 10)).to.be.equal(selectors.fixFailedMessage)
          expect(events[1].returnValues.data.slice(0, 10)).to.be.equal(selectors.fixFailedMessage)
        })
      })

      describe('custom token pair', () => {
        it('should allow to set custom bridged token', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const deployedToken = await contract.bridgedTokenAddress(otherSideToken1)

          await contract.setCustomTokenAddressPair(otherSideToken2, token.address).should.be.rejected
          await contract.setCustomTokenAddressPair(otherSideToken2, ambBridgeContract.address).should.be.rejected
          await token.transferOwnership(contract.address).should.be.fulfilled
          await contract.setCustomTokenAddressPair(otherSideToken2, token.address, { from: user }).should.be.rejected
          await contract.setCustomTokenAddressPair(otherSideToken1, token.address).should.be.rejected
          await contract.setCustomTokenAddressPair(otherSideToken2, deployedToken).should.be.rejected
          await contract.setCustomTokenAddressPair(otherSideToken2, token.address).should.be.fulfilled
          await contract.setCustomTokenAddressPair(otherSideToken2, token.address).should.be.rejected

          expect(await contract.bridgedTokenAddress(otherSideToken2)).to.be.equal(token.address)
          expect(await contract.nativeTokenAddress(token.address)).to.be.equal(otherSideToken2)
        })

        it('should not work for different decimals', async () => {
          token = await PermittableToken.new('Test', 'TST', 18, 1337)
          await token.transferOwnership(contract.address).should.be.fulfilled
          await contract.setCustomTokenAddressPair(otherSideToken1, token.address).should.be.fulfilled

          const deployArgs1 = [otherSideToken1, 'Test', 'TST', 20, user, value]
          const deployArgs2 = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data1 = contract.contract.methods.deployAndHandleBridgedTokens(...deployArgs1).encodeABI()
          const data2 = contract.contract.methods.deployAndHandleBridgedTokens(...deployArgs2).encodeABI()
          expect(await executeMessageCall(exampleMessageId, data1)).to.be.equal(false)
          expect(await executeMessageCall(otherMessageId, data2)).to.be.equal(true)
        })
      })
    })
  })

  if (isHome) {
    describe('fees management', () => {
      let homeToForeignFee
      let foreignToHomeFee
      let feeManager
      beforeEach(async () => {
        await initialize().should.be.fulfilled
        feeManager = await OmnibridgeFeeManager.new(contract.address, owner, [owner], [ether('0.02'), ether('0.01')])
        await contract.setFeeManager(feeManager.address, { from: owner }).should.be.fulfilled

        const initialEvents = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
        expect(initialEvents.length).to.be.equal(0)

        homeToForeignFee = await feeManager.HOME_TO_FOREIGN_FEE()
        foreignToHomeFee = await feeManager.FOREIGN_TO_HOME_FEE()
      })

      it('change reward addresses', async () => {
        await feeManager.addRewardAddress(accounts[8], { from: user }).should.be.rejected
        await feeManager.addRewardAddress(owner).should.be.rejected
        await feeManager.addRewardAddress(accounts[8]).should.be.fulfilled

        expect(await feeManager.rewardAddressList()).to.be.eql([owner, accounts[8]])
        expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('2')
        expect(await feeManager.isRewardAddress(owner)).to.be.equal(true)
        expect(await feeManager.isRewardAddress(accounts[8])).to.be.equal(true)

        await feeManager.addRewardAddress(accounts[9]).should.be.fulfilled
        expect(await feeManager.rewardAddressList()).to.be.eql([owner, accounts[8], accounts[9]])
        expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('3')

        await feeManager.removeRewardAddress(owner, { from: user }).should.be.rejected
        await feeManager.removeRewardAddress(accounts[7]).should.be.rejected
        await feeManager.removeRewardAddress(accounts[8]).should.be.fulfilled
        await feeManager.removeRewardAddress(accounts[8]).should.be.rejected

        expect(await feeManager.rewardAddressList()).to.be.eql([owner, accounts[9]])
        expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('2')
        expect(await feeManager.isRewardAddress(accounts[8])).to.be.equal(false)

        await feeManager.removeRewardAddress(owner).should.be.fulfilled
        expect(await feeManager.rewardAddressList()).to.be.eql([accounts[9]])
        expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('1')
        expect(await feeManager.isRewardAddress(owner)).to.be.equal(false)

        await feeManager.removeRewardAddress(accounts[9]).should.be.fulfilled
        expect(await feeManager.rewardAddressList()).to.be.eql([])
        expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('0')
        expect(await feeManager.isRewardAddress(accounts[9])).to.be.equal(false)
      })

      describe('initialize fees', () => {
        it('should initialize fees for native token', async () => {
          await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          expect(await feeManager.getFee(homeToForeignFee, token.address)).to.be.bignumber.equal(ether('0.02'))
          expect(await feeManager.getFee(foreignToHomeFee, token.address)).to.be.bignumber.equal(ether('0.01'))
        })

        it('should initialize fees for bridged token', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

          expect(await feeManager.getFee(homeToForeignFee, bridgedToken)).to.be.bignumber.equal(ether('0.02'))
          expect(await feeManager.getFee(foreignToHomeFee, bridgedToken)).to.be.bignumber.equal(ether('0.01'))
        })
      })

      describe('update fee parameters', () => {
        it('should update default fee value', async () => {
          await feeManager.setFee(homeToForeignFee, ZERO_ADDRESS, ether('0.1'), { from: user }).should.be.rejected
          await feeManager.setFee(homeToForeignFee, ZERO_ADDRESS, ether('1.1'), { from: owner }).should.be.rejected
          const { logs } = await feeManager.setFee(homeToForeignFee, ZERO_ADDRESS, ether('0.1'), { from: owner }).should
            .be.fulfilled

          expectEventInLogs(logs, 'FeeUpdated')
          expect(await feeManager.getFee(homeToForeignFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.1'))
          expect(await feeManager.getFee(foreignToHomeFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.01'))
        })

        it('should update default opposite direction fee value', async () => {
          await feeManager.setFee(foreignToHomeFee, ZERO_ADDRESS, ether('0.1'), { from: user }).should.be.rejected
          await feeManager.setFee(foreignToHomeFee, ZERO_ADDRESS, ether('1.1'), { from: owner }).should.be.rejected
          const { logs } = await feeManager.setFee(foreignToHomeFee, ZERO_ADDRESS, ether('0.1'), { from: owner }).should
            .be.fulfilled

          expectEventInLogs(logs, 'FeeUpdated')
          expect(await feeManager.getFee(foreignToHomeFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.1'))
          expect(await feeManager.getFee(homeToForeignFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.02'))
        })

        it('should update fee value for native token', async () => {
          await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled

          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          await feeManager.setFee(homeToForeignFee, token.address, ether('0.1'), { from: user }).should.be.rejected
          await feeManager.setFee(homeToForeignFee, token.address, ether('1.1'), { from: owner }).should.be.rejected
          const { logs: logs1 } = await feeManager.setFee(homeToForeignFee, token.address, ether('0.1'), {
            from: owner,
          }).should.be.fulfilled
          const { logs: logs2 } = await feeManager.setFee(foreignToHomeFee, token.address, ether('0.2'), {
            from: owner,
          }).should.be.fulfilled

          expectEventInLogs(logs1, 'FeeUpdated')
          expectEventInLogs(logs2, 'FeeUpdated')
          expect(await feeManager.getFee(homeToForeignFee, token.address)).to.be.bignumber.equal(ether('0.1'))
          expect(await feeManager.getFee(foreignToHomeFee, token.address)).to.be.bignumber.equal(ether('0.2'))
        })

        it('should update fee value for bridged token', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

          await feeManager.setFee(homeToForeignFee, bridgedToken, ether('0.1'), { from: user }).should.be.rejected
          await feeManager.setFee(homeToForeignFee, bridgedToken, ether('1.1'), { from: owner }).should.be.rejected
          const { logs: logs1 } = await feeManager.setFee(homeToForeignFee, bridgedToken, ether('0.1'), { from: owner })
            .should.be.fulfilled
          const { logs: logs2 } = await feeManager.setFee(foreignToHomeFee, bridgedToken, ether('0.2'), { from: owner })
            .should.be.fulfilled

          expectEventInLogs(logs1, 'FeeUpdated')
          expectEventInLogs(logs2, 'FeeUpdated')
          expect(await feeManager.getFee(homeToForeignFee, bridgedToken)).to.be.bignumber.equal(ether('0.1'))
          expect(await feeManager.getFee(foreignToHomeFee, bridgedToken)).to.be.bignumber.equal(ether('0.2'))
        })
      })

      function testHomeToForeignFee(isNative) {
        it('should collect and distribute 0% fee', async () => {
          await feeManager.setFee(homeToForeignFee, isNative ? ZERO_ADDRESS : token.address, ZERO).should.be.fulfilled
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ZERO)
          await token.transferAndCall(contract.address, value, '0x', { from: user })
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(value)
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(isNative ? ether('1') : ZERO)
          await token.transferAndCall(contract.address, value, '0x', { from: user })
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(isNative ? ether('2') : ZERO)

          const feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
          expect(feeEvents.length).to.be.equal(0)
        })

        it('should collect and distribute 2% fee', async () => {
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ZERO)
          await token.transferAndCall(contract.address, value, '0x', { from: user })
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(value)
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(isNative ? ether('0.98') : ZERO)
          expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('0.02'))
          await token.transferAndCall(contract.address, value, '0x', { from: user })
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(isNative ? ether('1.96') : ZERO)
          expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('0.04'))

          const feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
          expect(feeEvents.length).to.be.equal(2)
        })

        it('should collect and distribute 2% fee between two reward addresses', async () => {
          await feeManager.addRewardAddress(accounts[9]).should.be.fulfilled
          expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('2')

          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ZERO)
          await token.transferAndCall(contract.address, ether('0.100000000000000050'), '0x', { from: user }).should.be
            .fulfilled
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(
            ether('0.100000000000000050')
          )
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(
            isNative ? ether('0.098000000000000049') : ZERO
          )

          const balance1 = (await token.balanceOf(owner)).toString()
          const balance2 = (await token.balanceOf(accounts[9])).toString()
          expect(
            (balance1 === '1000000000000001' && balance2 === '1000000000000000') ||
              (balance1 === '1000000000000000' && balance2 === '1000000000000001')
          ).to.be.equal(true)

          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(
            ether('1.100000000000000050')
          )
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(
            isNative ? ether('1.078000000000000049') : ZERO
          )

          const feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
          expect(feeEvents.length).to.be.equal(2)
        })

        it('should not collect and distribute fee if sender is a reward address', async () => {
          await token.transferAndCall(owner, value, '0x', { from: user }).should.be.fulfilled

          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(ZERO)
          await token.transferAndCall(contract.address, value, '0x', { from: owner }).should.be.fulfilled
          expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(value)
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(isNative ? ether('1') : ZERO)
          expect(await token.balanceOf(owner)).to.be.bignumber.equal(ZERO)

          const feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
          expect(feeEvents.length).to.be.equal(0)
        })
      }

      describe('distribute fee for native tokens', () => {
        describe('distribute fee for home => foreign direction', async () => {
          beforeEach(async () => {
            await token.mint(user, ether('10')).should.be.fulfilled
          })

          testHomeToForeignFee(true)
        })

        describe('distribute fee for foreign => home direction', async () => {
          beforeEach(async () => {
            await feeManager.setFee(homeToForeignFee, ZERO_ADDRESS, ZERO).should.be.fulfilled
            await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled
            await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
            await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          })

          it('should collect and distribute 0% fee', async () => {
            await feeManager.setFee(foreignToHomeFee, token.address, ZERO).should.be.fulfilled
            const data = contract.contract.methods.handleNativeTokens(token.address, user, value).encodeABI()

            expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

            let event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(1)
            expect(event[0].returnValues.token).to.be.equal(token.address)
            expect(event[0].returnValues.recipient).to.be.equal(user)
            expect(event[0].returnValues.value).to.be.equal(value.toString())
            expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)

            let feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(0)

            expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
            expect(await contract.totalExecutedPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)

            event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(2)
            expect(event[1].returnValues.token).to.be.equal(token.address)
            expect(event[1].returnValues.recipient).to.be.equal(user)
            expect(event[1].returnValues.value).to.be.equal(value.toString())
            expect(event[1].returnValues.messageId).to.be.equal(otherMessageId)

            feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(0)

            expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('10'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            expect(await token.balanceOf(owner)).to.be.bignumber.equal(ZERO)
          })

          it('should collect and distribute 1% fee', async () => {
            const data = contract.contract.methods.handleNativeTokens(token.address, user, value).encodeABI()

            expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

            let event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(1)
            expect(event[0].returnValues.token).to.be.equal(token.address)
            expect(event[0].returnValues.recipient).to.be.equal(user)
            expect(event[0].returnValues.value).to.be.equal(ether('0.99').toString())
            expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)

            let feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(1)

            expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('8.99'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
            expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('0.01'))

            expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
            expect(await contract.totalExecutedPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)

            event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(2)
            expect(event[1].returnValues.token).to.be.equal(token.address)
            expect(event[1].returnValues.recipient).to.be.equal(user)
            expect(event[1].returnValues.value).to.be.equal(ether('0.99').toString())
            expect(event[1].returnValues.messageId).to.be.equal(otherMessageId)

            feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(2)

            expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('9.98'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('0.02'))
          })

          it('should collect and distribute 1% fee between two reward addresses', async () => {
            await feeManager.addRewardAddress(accounts[9]).should.be.fulfilled
            expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('2')

            const data = contract.contract.methods
              .handleNativeTokens(token.address, user, ether('0.200000000000000100'))
              .encodeABI()

            expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

            let event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(1)

            let feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(1)

            expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('8.198000000000000099'))
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ether('1.799999999999999900'))
            const balance1 = (await token.balanceOf(owner)).toString()
            const balance2 = (await token.balanceOf(accounts[9])).toString()
            expect(
              (balance1 === '1000000000000001' && balance2 === '1000000000000000') ||
                (balance1 === '1000000000000000' && balance2 === '1000000000000001')
            ).to.be.equal(true)

            expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
            expect(await contract.totalExecutedPerDay(token.address, currentDay)).to.be.bignumber.equal(
              ether('0.400000000000000200')
            )

            event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(2)

            feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(2)
          })
        })
      })

      describe('distribute fee for bridged tokens', () => {
        describe('distribute fee for foreign => home direction', async () => {
          it('should collect and distribute 0% fee', async () => {
            await feeManager.setFee(foreignToHomeFee, ZERO_ADDRESS, ZERO).should.be.fulfilled
            const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
            const deployData = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

            expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
            const bridgedToken = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))

            let event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(1)
            expect(event[0].returnValues.token).to.be.equal(bridgedToken.address)
            expect(event[0].returnValues.recipient).to.be.equal(user)
            expect(event[0].returnValues.value).to.be.equal(value.toString())
            expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)

            let feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(0)

            const data = await contract.contract.methods
              .handleBridgedTokens(otherSideToken1, user, value.toString())
              .encodeABI()

            expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
            expect(await contract.totalExecutedPerDay(bridgedToken.address, currentDay)).to.be.bignumber.equal(
              twoEthers
            )

            event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(2)
            expect(event[1].returnValues.token).to.be.equal(bridgedToken.address)
            expect(event[1].returnValues.recipient).to.be.equal(user)
            expect(event[1].returnValues.value).to.be.equal(value.toString())
            expect(event[1].returnValues.messageId).to.be.equal(otherMessageId)

            feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(0)

            expect(await bridgedToken.balanceOf(user)).to.be.bignumber.equal(twoEthers)
            expect(await bridgedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            expect(await bridgedToken.balanceOf(owner)).to.be.bignumber.equal(ZERO)
          })

          it('should collect and distribute 1% fee', async () => {
            const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
            const deployData = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

            expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
            const bridgedToken = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))

            let event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(1)
            expect(event[0].returnValues.token).to.be.equal(bridgedToken.address)
            expect(event[0].returnValues.recipient).to.be.equal(user)
            expect(event[0].returnValues.value).to.be.equal(ether('0.99').toString())
            expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)

            let feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(1)

            expect(await bridgedToken.balanceOf(user)).to.be.bignumber.equal(ether('0.99'))
            expect(await bridgedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            expect(await bridgedToken.balanceOf(owner)).to.be.bignumber.equal(ether('0.01'))

            const data = await contract.contract.methods
              .handleBridgedTokens(otherSideToken1, user, value.toString())
              .encodeABI()

            expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
            expect(await contract.totalExecutedPerDay(bridgedToken.address, currentDay)).to.be.bignumber.equal(
              twoEthers
            )

            event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(2)
            expect(event[1].returnValues.token).to.be.equal(bridgedToken.address)
            expect(event[1].returnValues.recipient).to.be.equal(user)
            expect(event[1].returnValues.value).to.be.equal(ether('0.99').toString())
            expect(event[1].returnValues.messageId).to.be.equal(otherMessageId)

            feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(2)

            expect(await bridgedToken.balanceOf(user)).to.be.bignumber.equal(ether('1.98'))
            expect(await bridgedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            expect(await bridgedToken.balanceOf(owner)).to.be.bignumber.equal(ether('0.02'))
          })

          it('should collect and distribute 1% fee between two reward addresses', async () => {
            await feeManager.addRewardAddress(accounts[9]).should.be.fulfilled
            expect(await feeManager.rewardAddressCount()).to.be.bignumber.equal('2')

            const args = [otherSideToken1, 'Test', 'TST', 18, user, ether('0.200000000000000100')]
            const deployData = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

            expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
            const bridgedToken = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))

            let event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(1)

            let feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(1)

            expect(await bridgedToken.balanceOf(user)).to.be.bignumber.equal(ether('0.198000000000000099'))
            expect(await bridgedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
            const balance1 = (await bridgedToken.balanceOf(owner)).toString()
            const balance2 = (await bridgedToken.balanceOf(accounts[9])).toString()
            expect(
              (balance1 === '1000000000000001' && balance2 === '1000000000000000') ||
                (balance1 === '1000000000000000' && balance2 === '1000000000000001')
            ).to.be.equal(true)

            const data = await contract.contract.methods
              .handleBridgedTokens(otherSideToken1, user, ether('0.200000000000000100').toString(10))
              .encodeABI()

            expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
            expect(await contract.totalExecutedPerDay(bridgedToken.address, currentDay)).to.be.bignumber.equal(
              ether('0.400000000000000200')
            )

            event = await getEvents(contract, { event: 'TokensBridged' })
            expect(event.length).to.be.equal(2)

            feeEvents = await getEvents(contract, { event: 'FeeDistributed' })
            expect(feeEvents.length).to.be.equal(2)
          })
        })

        describe('distribute fee for home => foreign direction', async () => {
          beforeEach(async () => {
            await feeManager.setFee(foreignToHomeFee, ZERO_ADDRESS, ZERO).should.be.fulfilled
            const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
            const deployData = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

            expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
            expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
            token = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))
          })

          testHomeToForeignFee(false)
        })
      })
    })

    describe('oracle driven lane permissions', () => {
      let manager
      beforeEach(async () => {
        manager = await MultiTokenForwardingRulesManager.new(owner)
        expect(await manager.owner()).to.be.equal(owner)
      })

      it('should allow to update manager address', async () => {
        await initialize().should.be.fulfilled
        await contract.setForwardingRulesManager(manager.address, { from: user }).should.be.rejected
        await contract.setForwardingRulesManager(manager.address, { from: owner }).should.be.fulfilled

        expect(await contract.forwardingRulesManager()).to.be.equal(manager.address)

        const otherManager = await MultiTokenForwardingRulesManager.new(contract.address)
        await contract.setForwardingRulesManager(otherManager.address).should.be.fulfilled

        expect(await contract.forwardingRulesManager()).to.be.equal(otherManager.address)

        await contract.setForwardingRulesManager(owner).should.be.rejected
        await contract.setForwardingRulesManager(ZERO_ADDRESS).should.be.fulfilled

        expect(await contract.forwardingRulesManager()).to.be.equal(ZERO_ADDRESS)
      })

      it('should allow to set/update lane permissions', async () => {
        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('0')

        await manager.setTokenForwardingRule(token.address, true, { from: user }).should.be.rejected
        await manager.setTokenForwardingRule(token.address, true, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('1')

        await manager.setSenderExceptionForTokenForwardingRule(token.address, user, true, { from: user }).should.be
          .rejected
        await manager.setSenderExceptionForTokenForwardingRule(token.address, user, true, { from: owner }).should.be
          .fulfilled

        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('-1')
        expect(await manager.destinationLane(token.address, user2, user2)).to.be.bignumber.equal('1')

        await manager.setSenderExceptionForTokenForwardingRule(token.address, user, false, { from: owner }).should.be
          .fulfilled
        await manager.setReceiverExceptionForTokenForwardingRule(token.address, user, true, { from: user }).should.be
          .rejected
        await manager.setReceiverExceptionForTokenForwardingRule(token.address, user, true, { from: owner }).should.be
          .fulfilled

        expect(await manager.destinationLane(token.address, user, user)).to.be.bignumber.equal('-1')
        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('1')

        await manager.setTokenForwardingRule(token.address, false, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user2, user2)).to.be.bignumber.equal('0')

        await manager.setSenderForwardingRule(user2, true, { from: user }).should.be.rejected
        await manager.setSenderForwardingRule(user2, true, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user2, user2)).to.be.bignumber.equal('1')

        await manager.setReceiverForwardingRule(user2, true, { from: user }).should.be.rejected
        await manager.setReceiverForwardingRule(user2, true, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('1')
      })

      it('should send a message to the oracle-driven lane', async () => {
        await initialize().should.be.fulfilled
        await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled
        const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
        const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
        expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
        const bridgedToken = await PermittableToken.at(await contract.bridgedTokenAddress(otherSideToken1))

        await token.transferAndCall(contract.address, ether('0.1'), '0x', { from: user }).should.be.fulfilled
        await bridgedToken.transferAndCall(contract.address, ether('0.1'), '0x', { from: user }).should.be.fulfilled
        await contract.setForwardingRulesManager(manager.address, { from: owner }).should.be.fulfilled
        await token.transferAndCall(contract.address, ether('0.1'), '0x', { from: user }).should.be.fulfilled
        await bridgedToken.transferAndCall(contract.address, ether('0.1'), '0x', { from: user }).should.be.fulfilled
        await manager.setTokenForwardingRule(token.address, true, { from: owner }).should.be.fulfilled
        await manager.setTokenForwardingRule(bridgedToken.address, true, { from: owner }).should.be.fulfilled
        await token.transferAndCall(contract.address, ether('0.1'), '0x', { from: user }).should.be.fulfilled
        await bridgedToken.transferAndCall(contract.address, ether('0.1'), '0x', { from: user }).should.be.fulfilled

        const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
        expect(events.length).to.be.equal(6)
        expect(events[0].returnValues.dataType).to.be.bignumber.equal('0')
        expect(events[1].returnValues.dataType).to.be.bignumber.equal('0')
        expect(events[2].returnValues.dataType).to.be.bignumber.equal('128')
        expect(events[3].returnValues.dataType).to.be.bignumber.equal('128')
        expect(events[4].returnValues.dataType).to.be.bignumber.equal('0')
        expect(events[5].returnValues.dataType).to.be.bignumber.equal('0')
      })
    })
  }

  if (!isHome) {
    describe('compound connector', () => {
      const faucet = accounts[6] // account where all Compound-related DAIs where minted

      let dai
      let cDai
      let comptroller
      let comp
      let daiInterestImpl

      before(async () => {
        const contracts = await getCompoundContracts()
        dai = contracts.dai
        cDai = contracts.cDai
        comptroller = contracts.comptroller
        comp = contracts.comp
      })

      beforeEach(async () => {
        const storageProxy = await EternalStorageProxy.new()
        await storageProxy.upgradeTo('1', contract.address).should.be.fulfilled
        contract = await Mediator.at(storageProxy.address)
        await initialize({
          limits: [ether('100'), ether('99'), ether('0.01')],
          executionLimits: [ether('100'), ether('99')],
        })
        daiInterestImpl = await CompoundInterestERC20.new(contract.address, owner, 1, accounts[2])
        await daiInterestImpl.enableInterestToken(cDai.address, oneEther, accounts[2], ether('0.01'))
        await dai.approve(contract.address, ether('100'), { from: faucet })
        await contract.methods['relayTokens(address,uint256)'](dai.address, ether('10'), { from: faucet })
      })

      async function generateInterest() {
        await cDai.borrow(ether('10'), { from: faucet }).should.be.fulfilled
        await comptroller.fastForward(200000).should.be.fulfilled
        await cDai.repayBorrow(ether('20'), { from: faucet }).should.be.fulfilled
      }

      it('should initialize interest', async () => {
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('10'))
        expect(await contract.interestImplementation(dai.address)).to.be.equal(ZERO_ADDRESS)

        const args = [dai.address, daiInterestImpl.address, oneEther]
        await contract.initializeInterest(...args, { from: user }).should.be.rejected
        await contract.initializeInterest(...args, { from: owner }).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('10'))
        expect(await cDai.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
        expect(await contract.interestImplementation(dai.address)).to.be.equal(daiInterestImpl.address)
        expect(await contract.minCashThreshold(dai.address)).to.be.bignumber.equal(oneEther)
      })

      it('should enable and earn interest', async () => {
        const initialBalance = await dai.balanceOf(accounts[2])
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)

        expect(await daiInterestImpl.interestAmount.call(dai.address)).to.be.bignumber.equal(ZERO)
        await contract.invest(dai.address).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await dai.balanceOf(accounts[2])).to.be.bignumber.equal(initialBalance)
        expect(await dai.balanceOf(daiInterestImpl.address)).to.be.bignumber.equal(ZERO)
        expect(await cDai.balanceOf(daiInterestImpl.address)).to.be.bignumber.gt(ZERO)
        expect(await daiInterestImpl.interestAmount.call(dai.address)).to.be.bignumber.equal(ZERO)

        await generateInterest()

        expect(await daiInterestImpl.interestAmount.call(dai.address)).to.be.bignumber.gt(ZERO)
      })

      it('should pay interest', async () => {
        const initialBalance = await dai.balanceOf(accounts[2])
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address).should.be.fulfilled
        await generateInterest()

        expect(await daiInterestImpl.interestAmount.call(dai.address)).to.be.bignumber.gt(ether('0.01'))

        await daiInterestImpl.payInterest(dai.address).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await dai.balanceOf(accounts[2])).to.be.bignumber.gt(initialBalance)
        expect(await cDai.balanceOf(daiInterestImpl.address)).to.be.bignumber.gt(ZERO)
        expect(await daiInterestImpl.interestAmount.call(dai.address)).to.be.bignumber.lt(ether('0.01'))
      })

      it('should disable interest', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address).should.be.fulfilled
        await generateInterest()
        await daiInterestImpl.payInterest(dai.address).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))

        await contract.disableInterest(dai.address, { from: user }).should.be.rejected
        await contract.disableInterest(dai.address, { from: owner }).should.be.fulfilled

        expect(await contract.interestImplementation(dai.address)).to.be.equal(ZERO_ADDRESS)
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('10'))
        expect(await cDai.balanceOf(daiInterestImpl.address)).to.be.bignumber.gt(ZERO)
      })

      it('configuration', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)

        await contract.setMinCashThreshold(dai.address, ether('2'), { from: user }).should.be.rejected
        await contract.setMinCashThreshold(dai.address, ether('2'), { from: owner }).should.be.fulfilled
        expect(await contract.minCashThreshold(dai.address)).to.be.bignumber.equal(ether('2'))

        await daiInterestImpl.setDust(dai.address, '1', { from: user }).should.be.rejected
        await daiInterestImpl.setDust(dai.address, '1', { from: owner }).should.be.fulfilled
        expect((await daiInterestImpl.interestParams(dai.address)).dust).to.be.bignumber.equal('1')

        await daiInterestImpl.setMinInterestPaid(dai.address, oneEther, { from: user }).should.be.rejected
        await daiInterestImpl.setMinInterestPaid(dai.address, oneEther, { from: owner }).should.be.fulfilled
        expect((await daiInterestImpl.interestParams(dai.address)).minInterestPaid).to.be.bignumber.equal(oneEther)

        await daiInterestImpl.setInterestReceiver(dai.address, accounts[1], { from: user }).should.be.rejected
        await daiInterestImpl.setInterestReceiver(dai.address, accounts[1], { from: owner }).should.be.fulfilled
        expect((await daiInterestImpl.interestParams(dai.address)).interestReceiver).to.be.equal(accounts[1])

        await daiInterestImpl.setMinCompPaid(oneEther, { from: user }).should.be.rejected
        await daiInterestImpl.setMinCompPaid(oneEther, { from: owner }).should.be.fulfilled
        expect(await daiInterestImpl.minCompPaid()).to.be.bignumber.equal(oneEther)

        await daiInterestImpl.setCompReceiver(user, { from: user }).should.be.rejected
        await daiInterestImpl.setCompReceiver(user, { from: owner }).should.be.fulfilled
        expect(await daiInterestImpl.compReceiver()).to.be.equal(user)
      })

      it('should claim comp', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        await generateInterest()

        const initialBalance = await comp.balanceOf(accounts[2])
        expect(await daiInterestImpl.compAmount.call([cDai.address])).to.be.bignumber.gt(ZERO)
        await daiInterestImpl.claimCompAndPay([cDai.address])
        expect(await daiInterestImpl.compAmount.call([cDai.address])).to.be.bignumber.equal(ZERO)
        expect(await comp.balanceOf(accounts[2])).to.be.bignumber.gt(initialBalance)
      })

      it('should return invested tokens on withdrawal if needed', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        const data1 = contract.contract.methods.handleNativeTokens(dai.address, user, ether('0.5')).encodeABI()
        expect(await executeMessageCall(exampleMessageId, data1)).to.be.equal(true)

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('0.5'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('9.5'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))

        const data2 = contract.contract.methods.handleNativeTokens(dai.address, user, ether('2')).encodeABI()
        expect(await executeMessageCall(otherMessageId, data2)).to.be.equal(true)

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('7.5'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('6.5'))
      })

      it('should allow to fix correct amount of tokens when compound is used', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        await dai.transfer(contract.address, ether('1'), { from: faucet })

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('2'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        await contract.fixMediatorBalance(dai.address, owner, { from: owner }).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('2'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('11'))
      })

      it('should force disable interest implementation', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        await daiInterestImpl.forceDisable(dai.address, { from: user }).should.be.rejected
        await daiInterestImpl.forceDisable(dai.address, { from: owner }).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.gt(ether('9.999'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('0'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))
      })

      it('should allow to reinitialize when there are no invested funds', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        await generateInterest()

        await daiInterestImpl.enableInterestToken(cDai.address, oneEther, accounts[2], ether('0.01')).should.be.rejected

        await contract.disableInterest(dai.address, { from: owner }).should.be.fulfilled

        await daiInterestImpl.enableInterestToken(cDai.address, oneEther, accounts[2], ether('0.01')).should.be
          .fulfilled
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
      })
    })

    describe('aave connector', () => {
      let dai
      let usdc
      let aDai
      let lendingPool
      let incentivesController
      let aave
      let stkAAVE
      let daiInterestImpl

      const borrower = accounts[2]

      before(async () => {
        const contracts = await getAAVEContracts(web3, accounts[8])
        dai = contracts.dai
        usdc = contracts.usdc
        aDai = contracts.aDai
        lendingPool = contracts.lendingPool
        incentivesController = contracts.incentivesController
        aave = contracts.aave
        stkAAVE = contracts.stkAAVE

        // create some preliminary deposit
        await dai.mint(ether('10000000'))
        await dai.approve(lendingPool.address, ether('10000000'))
        await lendingPool.deposit(dai.address, ether('10000'), owner, 0)

        // create collateral for borrower account
        await usdc.mint(ether('1000000000'))
        await usdc.approve(lendingPool.address, ether('1000000000'))
        await lendingPool.deposit(usdc.address, ether('1000000000'), borrower, 0)

        web3.extend({
          property: 'evm',
          methods: [
            { name: 'mine', call: 'evm_mine' },
            { name: 'mineWithTime', call: 'evm_mine', params: 1, inputFormatter: [web3.utils.numberToHex] },
          ],
        })
      })

      beforeEach(async () => {
        const storageProxy = await EternalStorageProxy.new()
        await storageProxy.upgradeTo('1', contract.address).should.be.fulfilled
        contract = await Mediator.at(storageProxy.address)
        await initialize({
          limits: [ether('100'), ether('99'), ether('0.01')],
          executionLimits: [ether('100'), ether('99')],
        })
        daiInterestImpl = await AAVEInterestERC20.new(contract.address, owner, 1, accounts[2])
        await daiInterestImpl.enableInterestToken(dai.address, '1', accounts[2], ether('0.01'))
        await dai.approve(contract.address, ether('100'))
        await contract.methods['relayTokens(address,uint256)'](dai.address, ether('10'))
      })

      async function generateInterest() {
        const timestamp = (await web3.eth.getBlock('latest')).timestamp
        await lendingPool.borrow(dai.address, ether('1000'), 1, 0, borrower, { from: borrower })
        await web3.evm.mineWithTime(timestamp + 356 * 24 * 60 * 60).should.be.fulfilled
        await lendingPool.repay(dai.address, ether('1000000'), 1, borrower) // repay whole debt
      }

      it('should initialize interest', async () => {
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('10'))
        expect(await contract.interestImplementation(dai.address)).to.be.equal(ZERO_ADDRESS)

        const args = [dai.address, daiInterestImpl.address, oneEther]
        await contract.initializeInterest(...args, { from: user }).should.be.rejected
        await contract.initializeInterest(...args, { from: owner }).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('10'))
        expect(await aDai.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
        expect(await contract.interestImplementation(dai.address)).to.be.equal(daiInterestImpl.address)
        expect(await contract.minCashThreshold(dai.address)).to.be.bignumber.equal(oneEther)
      })

      it('should enable and earn interest', async () => {
        const initialBalance = await dai.balanceOf(accounts[2])
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)

        expect(await daiInterestImpl.interestAmount(dai.address)).to.be.bignumber.equal(ZERO)
        await contract.invest(dai.address).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await dai.balanceOf(accounts[2])).to.be.bignumber.equal(initialBalance)
        expect(await dai.balanceOf(daiInterestImpl.address)).to.be.bignumber.equal(ZERO)
        expect(await aDai.balanceOf(daiInterestImpl.address)).to.be.bignumber.gt(ZERO)
        expect(await daiInterestImpl.interestAmount(dai.address)).to.be.bignumber.equal(ZERO)

        await generateInterest()

        expect(await daiInterestImpl.interestAmount(dai.address)).to.be.bignumber.gt(ZERO)
      })

      it('should pay interest', async () => {
        const initialBalance = await dai.balanceOf(accounts[2])
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address).should.be.fulfilled
        await generateInterest()

        expect(await daiInterestImpl.interestAmount(dai.address)).to.be.bignumber.gt(ether('0.01'))

        await daiInterestImpl.payInterest(dai.address).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await dai.balanceOf(accounts[2])).to.be.bignumber.gt(initialBalance)
        expect(await aDai.balanceOf(daiInterestImpl.address)).to.be.bignumber.gt(ZERO)
        expect(await daiInterestImpl.interestAmount(dai.address)).to.be.bignumber.lt(ether('0.01'))
      })

      it('should disable interest', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address).should.be.fulfilled
        await generateInterest()
        await daiInterestImpl.payInterest(dai.address).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))

        await contract.disableInterest(dai.address, { from: user }).should.be.rejected
        await contract.disableInterest(dai.address, { from: owner }).should.be.fulfilled

        expect(await contract.interestImplementation(dai.address)).to.be.equal(ZERO_ADDRESS)
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('10'))
      })

      it('configuration', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)

        await contract.setMinCashThreshold(dai.address, ether('2'), { from: user }).should.be.rejected
        await contract.setMinCashThreshold(dai.address, ether('2'), { from: owner }).should.be.fulfilled
        expect(await contract.minCashThreshold(dai.address)).to.be.bignumber.equal(ether('2'))

        await daiInterestImpl.setDust(dai.address, '1', { from: user }).should.be.rejected
        await daiInterestImpl.setDust(dai.address, '1', { from: owner }).should.be.fulfilled
        expect((await daiInterestImpl.interestParams(dai.address)).dust).to.be.bignumber.equal('1')

        await daiInterestImpl.setMinInterestPaid(dai.address, oneEther, { from: user }).should.be.rejected
        await daiInterestImpl.setMinInterestPaid(dai.address, oneEther, { from: owner }).should.be.fulfilled
        expect((await daiInterestImpl.interestParams(dai.address)).minInterestPaid).to.be.bignumber.equal(oneEther)

        await daiInterestImpl.setInterestReceiver(dai.address, accounts[1], { from: user }).should.be.rejected
        await daiInterestImpl.setInterestReceiver(dai.address, accounts[1], { from: owner }).should.be.fulfilled
        expect((await daiInterestImpl.interestParams(dai.address)).interestReceiver).to.be.equal(accounts[1])

        await daiInterestImpl.setMinAavePaid(oneEther, { from: user }).should.be.rejected
        await daiInterestImpl.setMinAavePaid(oneEther, { from: owner }).should.be.fulfilled
        expect(await daiInterestImpl.minAavePaid()).to.be.bignumber.equal(oneEther)

        await daiInterestImpl.setAaveReceiver(user, { from: user }).should.be.rejected
        await daiInterestImpl.setAaveReceiver(user, { from: owner }).should.be.fulfilled
        expect(await daiInterestImpl.aaveReceiver()).to.be.equal(user)
      })

      it('should return invested tokens on withdrawal if needed', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        const data1 = contract.contract.methods.handleNativeTokens(dai.address, user, ether('0.5')).encodeABI()
        expect(await executeMessageCall(exampleMessageId, data1)).to.be.equal(true)

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('0.5'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('9.5'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))

        const data2 = contract.contract.methods.handleNativeTokens(dai.address, user, ether('2')).encodeABI()
        expect(await executeMessageCall(otherMessageId, data2)).to.be.equal(true)

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('7.5'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('6.5'))
      })

      it('should allow to fix correct amount of tokens when aave is used', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        await dai.transfer(contract.address, ether('1'))

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('2'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        await contract.fixMediatorBalance(dai.address, owner, { from: owner }).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('2'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('11'))
      })

      it('should force disable interest implementation', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.equal(ether('1'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('9'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))

        await daiInterestImpl.forceDisable(dai.address, { from: user }).should.be.rejected
        await daiInterestImpl.forceDisable(dai.address, { from: owner }).should.be.fulfilled

        expect(await dai.balanceOf(contract.address)).to.be.bignumber.gt(ether('9.999'))
        expect(await daiInterestImpl.investedAmount(dai.address)).to.be.bignumber.equal(ether('0'))
        expect(await contract.mediatorBalance(dai.address)).to.be.bignumber.equal(ether('10'))
      })

      it('should allow to reinitialize when there are no invested funds', async () => {
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
        await generateInterest()

        await daiInterestImpl.enableInterestToken(dai.address, oneEther, accounts[2], ether('0.01')).should.be.rejected

        await contract.disableInterest(dai.address, { from: owner }).should.be.fulfilled

        await daiInterestImpl.enableInterestToken(dai.address, oneEther, accounts[2], ether('0.01')).should.be.fulfilled
        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)
      })

      it('should claim rewards', async () => {
        await aave.mint(ether('20000000'))
        await aave.transfer(incentivesController.address, ether('10000000'))
        await aave.approve(stkAAVE.address, ether('10000000'))
        await incentivesController.setDistributionEnd('1000000000000000000')
        await incentivesController.initialize(ZERO_ADDRESS)
        await incentivesController.configureAssets([aDai.address], [oneEther])

        await contract.initializeInterest(dai.address, daiInterestImpl.address, oneEther)
        await contract.invest(dai.address)

        await generateInterest()

        expect(await daiInterestImpl.aaveAmount([aDai.address])).to.be.bignumber.gt(ether('0.01'))

        await daiInterestImpl.claimAaveAndPay([aDai.address]).should.be.fulfilled

        expect(await aave.balanceOf(accounts[2])).to.be.bignumber.equal(ZERO)
        expect(await stkAAVE.balanceOf(accounts[2])).to.be.bignumber.gt(ether('0.01'))
        expect(await stkAAVE.stakersCooldowns(accounts[2])).to.be.bignumber.equal(ZERO)
        await stkAAVE.redeem(accounts[2], ether('100000000'), { from: accounts[2] }).should.be.rejected
        expect(await stkAAVE.cooldown({ from: accounts[2] }))
        expect(await stkAAVE.stakersCooldowns(accounts[2])).to.be.bignumber.gt(ZERO)
        await stkAAVE.redeem(accounts[2], ether('100000000'), { from: accounts[2] }).should.be.rejected

        // skip 11 days (COOLDOWN_SECONDS + UNSTAKE_WINDOW / 2)
        const timestamp = (await web3.eth.getBlock('latest')).timestamp
        await web3.evm.mineWithTime(timestamp + 11 * 24 * 60 * 60).should.be.fulfilled

        await stkAAVE.redeem(accounts[2], ether('100000000'), { from: accounts[2] }).should.be.fulfilled

        expect(await aave.balanceOf(accounts[2])).to.be.bignumber.gt(ZERO)
        expect(await stkAAVE.balanceOf(accounts[2])).to.be.bignumber.equal(ZERO)
      })
    })
  }
}

contract('ForeignOmnibridge', (accounts) => {
  runTests(accounts, false)
})

contract('HomeOmnibridge', (accounts) => {
  runTests(accounts, true)
})
