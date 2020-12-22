const HomeOmnibridge = artifacts.require('HomeOmnibridge')
const ForeignOmnibridge = artifacts.require('ForeignOmnibridge')
const EternalStorageProxy = artifacts.require('EternalStorageProxy')
const AMBMock = artifacts.require('AMBMock')
const Sacrifice = artifacts.require('Sacrifice')
const TokenFactory = artifacts.require('TokenFactory')
const MultiTokenForwardingRulesManager = artifacts.require('MultiTokenForwardingRulesManager')

const { expect } = require('chai')
const { getEvents, ether, expectEventInLogs } = require('../helpers/helpers')
const { ZERO_ADDRESS, toBN, requirePrecompiled } = require('../setup')

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
const failedMessageId = '0x2ebc2ccc755acc8eaf9252e19573af708d644ab63a39619adb080a3500a4ff2e'

function runTests(accounts, isHome) {
  const Mediator = isHome ? HomeOmnibridge : ForeignOmnibridge
  const modifyName = (name) => name + (isHome ? ' on xDai' : ' on Mainnet')
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
      opts.requestGasLimit || 1000000,
      opts.owner || owner,
      opts.tokenFactory || tokenFactory.address,
    ]
    if (isHome) {
      args.push(opts.rewardReceivers || [], opts.fees || [ZERO, ZERO])
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
  ]

  before(async () => {
    ERC677BridgeToken = await requirePrecompiled('ERC677BridgeToken')
    PermittableToken = await requirePrecompiled('PermittableToken')

    tokenImage = await PermittableToken.new('TEST', 'TST', 18, 1337)
    tokenFactory = await TokenFactory.new(owner, tokenImage.address)
  })

  beforeEach(async () => {
    contract = await Mediator.new()
    ambBridgeContract = await AMBMock.new()
    token = await ERC677BridgeToken.new('TEST', 'TST', 18)
    currentDay = await contract.getCurrentDay()
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
      await initialize({
        rewardReceivers: [accounts[9]],
        fees: [ether('0.1'), ether('0.2')],
      }).should.be.fulfilled
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
      expect(await contract.requestGasLimit()).to.be.bignumber.equal(ZERO)
      expect(await contract.owner()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.tokenFactory()).to.be.equal(ZERO_ADDRESS)
      if (isHome) {
        expect(await contract.getFee(await contract.HOME_TO_FOREIGN_FEE(), ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
        expect(await contract.getFee(await contract.FOREIGN_TO_HOME_FEE(), ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      }

      // When
      // not valid bridge address
      await initialize({ ambContract: ZERO_ADDRESS }).should.be.rejected

      // dailyLimit > maxPerTx
      await initialize({ limits: [maxPerTx, maxPerTx, minPerTx] }).should.be.rejected

      // maxPerTx > minPerTx
      await initialize({ limits: [dailyLimit, minPerTx, minPerTx] }).should.be.rejected

      // executionDailyLimit > executionMaxPerTx
      await initialize({ executionLimits: [executionDailyLimit, executionDailyLimit] }).should.be.rejected

      // maxGasPerTx > bridge maxGasPerTx
      await initialize({ requestGasLimit: ether('1') }).should.be.rejected

      // not valid owner
      await initialize({ owner: ZERO_ADDRESS }).should.be.rejected

      // token factory is not a contract
      await initialize({ tokenFactory: owner }).should.be.rejected

      if (isHome) {
        // duplicated address in the reward receivers list
        await initialize({ rewardReceivers: [owner, owner] }).should.be.rejected

        // invalid fees
        await initialize({ fees: [ether('1.01'), ether('0.01')] }).should.be.rejected
        await initialize({ fees: [ether('0.01'), ether('1.01')] }).should.be.rejected
      }

      const options = { rewardReceivers: [accounts[8]], fees: [ether('0.1'), ether('0.2')] }
      const { logs } = await initialize(options).should.be.fulfilled

      // already initialized
      await initialize(options).should.be.rejected

      // Then
      expect(await contract.isInitialized()).to.be.equal(true)
      expect(await contract.bridgeContract()).to.be.equal(ambBridgeContract.address)
      expect(await contract.mediatorContractOnOtherSide()).to.be.equal(otherSideMediator)
      expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(dailyLimit)
      expect(await contract.maxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(maxPerTx)
      expect(await contract.minPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(minPerTx)
      expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(executionDailyLimit)
      expect(await contract.executionMaxPerTx(ZERO_ADDRESS)).to.be.bignumber.equal(executionMaxPerTx)
      expect(await contract.requestGasLimit()).to.be.bignumber.equal('1000000')
      expect(await contract.owner()).to.be.equal(owner)
      expect(await contract.tokenFactory()).to.be.equal(tokenFactory.address)
      if (isHome) {
        expect(await contract.getFee(await contract.HOME_TO_FOREIGN_FEE(), ZERO_ADDRESS)).to.be.bignumber.equal(
          ether('0.1')
        )
        expect(await contract.getFee(await contract.FOREIGN_TO_HOME_FEE(), ZERO_ADDRESS)).to.be.bignumber.equal(
          ether('0.2')
        )
        expect(await contract.rewardAddressList()).to.be.eql([accounts[8]])
      }

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

            let events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(1)
            const { data, messageId, dataType, executor } = events[0].returnValues
            expect(data.slice(2, 10)).to.be.equal('2ae87cdd')
            const args = web3.eth.abi.decodeParameters(
              ['address', 'string', 'string', 'uint8', 'address', 'uint256'],
              data.slice(10)
            )
            expect(executor).to.be.equal(otherSideMediator)
            expect(args[0]).to.be.equal(token.address)
            expect(args[1]).to.be.equal(await token.name())
            expect(args[2]).to.be.equal(await token.symbol())
            expect(args[3]).to.be.equal((await token.decimals()).toString())
            expect(args[4]).to.be.equal(receiver)
            expect(args[5]).to.be.equal(value.toString())
            expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal(messageId)
            expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(value)

            await send().should.be.fulfilled

            events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data: data2, dataType: dataType2 } = events[1].returnValues
            expect(data2.slice(2, 10)).to.be.equal('125e4cfb')
            const args2 = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data2.slice(10))
            expect(args2[0]).to.be.equal(token.address)
            expect(args2[1]).to.be.equal(receiver)
            expect(args2[2]).to.be.equal(value.toString())

            expect(dataType).to.be.equal('0')
            expect(dataType2).to.be.equal('0')
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal(twoEthers)
            expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(twoEthers)
            expect(await contract.isTokenRegistered(token.address)).to.be.equal(true)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(twoEthers)
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
              // User transfer tokens twice
              await send()
              await send()
              expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(twoEthers)

              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('8'))

              const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
              expect(events.length).to.be.equal(2)
              const transferMessageId1 = events[0].returnValues.messageId
              const transferMessageId2 = events[1].returnValues.messageId
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
              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('9'))
              expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ether('1'))
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId2)).to.be.equal(true)
              expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal(transferMessageId1)
              expect(await contract.minPerTx(token.address)).to.be.bignumber.gt('0')

              expect(await executeMessageCall(otherMessageId, fixData1)).to.be.equal(true)
              expect(await token.balanceOf(user)).to.be.bignumber.equal(ether('10'))
              expect(await contract.mediatorBalance(token.address)).to.be.bignumber.equal(ZERO)
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(true)
              expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal('0x'.padEnd(66, '0'))
              expect(await contract.minPerTx(token.address)).to.be.bignumber.equal('0')
              expect(await contract.maxPerTx(token.address)).to.be.bignumber.equal('0')
              expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal('0')
              expect(await contract.executionMaxPerTx(token.address)).to.be.bignumber.equal('0')
              expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal('0')

              const event = await getEvents(contract, { event: 'FailedMessageFixed' })
              expect(event.length).to.be.equal(2)
              expect(event[0].returnValues.messageId).to.be.equal(transferMessageId2)
              expect(event[0].returnValues.token).to.be.equal(token.address)
              expect(event[0].returnValues.recipient).to.be.equal(user)
              expect(event[0].returnValues.value).to.be.equal(value.toString())
              expect(event[1].returnValues.messageId).to.be.equal(transferMessageId1)
              expect(event[1].returnValues.token).to.be.equal(token.address)
              expect(event[1].returnValues.recipient).to.be.equal(user)
              expect(event[1].returnValues.value).to.be.equal(value.toString())

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
            expect(data.slice(2, 10)).to.be.equal('125e4cfb')
            const args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data.slice(10))
            expect(executor).to.be.equal(otherSideMediator)
            expect(dataType).to.be.bignumber.equal('0')
            expect(args[0]).to.be.equal(token.address)
            expect(args[1]).to.be.equal(owner)
            expect(args[2]).to.be.bignumber.equal(ether('2'))
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
          expect(data.slice(2, 10)).to.be.equal('0950d515')
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
          expect(events[0].returnValues.data.slice(2, 10)).to.be.equal('0950d515')
          expect(events[1].returnValues.data.slice(2, 10)).to.be.equal('0950d515')
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
            expect(data.slice(2, 10)).to.be.equal('272255bb')
            const args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data.slice(10))
            expect(executor).to.be.equal(otherSideMediator)
            expect(args[0]).to.be.equal(otherSideToken1)
            expect(args[1]).to.be.equal(receiver)
            expect(args[2]).to.be.equal(value.toString())
            expect(await contract.tokenRegistrationMessageId(otherSideToken1)).to.be.equal('0x'.padEnd(66, '0'))
            expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal('0x'.padEnd(66, '0'))
            expect(await contract.maxAvailablePerTx(token.address)).to.be.bignumber.equal(value)

            await send().should.be.fulfilled

            events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data: data2, dataType: dataType2 } = events[1].returnValues
            expect(data2.slice(2, 10)).to.be.equal('272255bb')
            const args2 = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data2.slice(10))
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
          expect(data.slice(2, 10)).to.be.equal('0950d515')
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
          expect(events[0].returnValues.data.slice(2, 10)).to.be.equal('0950d515')
          expect(events[1].returnValues.data.slice(2, 10)).to.be.equal('0950d515')
        })
      })
    })
  })

  if (isHome) {
    describe('fees management', () => {
      let homeToForeignFee
      let foreignToHomeFee
      beforeEach(async () => {
        await initialize({ rewardReceivers: [owner], fees: [ether('0.02'), ether('0.01')] }).should.be.fulfilled

        const initialEvents = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
        expect(initialEvents.length).to.be.equal(0)

        homeToForeignFee = await contract.HOME_TO_FOREIGN_FEE()
        foreignToHomeFee = await contract.FOREIGN_TO_HOME_FEE()
      })

      it('change reward addresses', async () => {
        await contract.addRewardAddress(accounts[8], { from: user }).should.be.rejected
        await contract.addRewardAddress(owner).should.be.rejected
        await contract.addRewardAddress(accounts[8]).should.be.fulfilled

        expect(await contract.rewardAddressList()).to.be.eql([accounts[8], owner])
        expect(await contract.rewardAddressCount()).to.be.bignumber.equal('2')
        expect(await contract.isRewardAddress(owner)).to.be.equal(true)
        expect(await contract.isRewardAddress(accounts[8])).to.be.equal(true)

        await contract.addRewardAddress(accounts[9]).should.be.fulfilled
        expect(await contract.rewardAddressList()).to.be.eql([accounts[9], accounts[8], owner])
        expect(await contract.rewardAddressCount()).to.be.bignumber.equal('3')

        await contract.removeRewardAddress(owner, { from: user }).should.be.rejected
        await contract.removeRewardAddress(accounts[7]).should.be.rejected
        await contract.removeRewardAddress(accounts[8]).should.be.fulfilled
        await contract.removeRewardAddress(accounts[8]).should.be.rejected

        expect(await contract.rewardAddressList()).to.be.eql([accounts[9], owner])
        expect(await contract.rewardAddressCount()).to.be.bignumber.equal('2')
        expect(await contract.isRewardAddress(accounts[8])).to.be.equal(false)

        await contract.removeRewardAddress(owner).should.be.fulfilled
        expect(await contract.rewardAddressList()).to.be.eql([accounts[9]])
        expect(await contract.rewardAddressCount()).to.be.bignumber.equal('1')
        expect(await contract.isRewardAddress(owner)).to.be.equal(false)

        await contract.removeRewardAddress(accounts[9]).should.be.fulfilled
        expect(await contract.rewardAddressList()).to.be.eql([])
        expect(await contract.rewardAddressCount()).to.be.bignumber.equal('0')
        expect(await contract.isRewardAddress(accounts[9])).to.be.equal(false)
      })

      describe('initialize fees', () => {
        it('should initialize fees for native token', async () => {
          await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled
          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          expect(await contract.getFee(homeToForeignFee, token.address)).to.be.bignumber.equal(ether('0.02'))
          expect(await contract.getFee(foreignToHomeFee, token.address)).to.be.bignumber.equal(ether('0.01'))
        })

        it('should initialize fees for bridged token', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

          expect(await contract.getFee(homeToForeignFee, bridgedToken)).to.be.bignumber.equal(ether('0.02'))
          expect(await contract.getFee(foreignToHomeFee, bridgedToken)).to.be.bignumber.equal(ether('0.01'))
        })
      })

      describe('update fee parameters', () => {
        it('should update default fee value', async () => {
          await contract.setFee(homeToForeignFee, ZERO_ADDRESS, ether('0.1'), { from: user }).should.be.rejected
          await contract.setFee(homeToForeignFee, ZERO_ADDRESS, ether('1.1'), { from: owner }).should.be.rejected
          const { logs } = await contract.setFee(homeToForeignFee, ZERO_ADDRESS, ether('0.1'), { from: owner }).should
            .be.fulfilled

          expectEventInLogs(logs, 'FeeUpdated')
          expect(await contract.getFee(homeToForeignFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.1'))
          expect(await contract.getFee(foreignToHomeFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.01'))
        })

        it('should update default opposite direction fee value', async () => {
          await contract.setFee(foreignToHomeFee, ZERO_ADDRESS, ether('0.1'), { from: user }).should.be.rejected
          await contract.setFee(foreignToHomeFee, ZERO_ADDRESS, ether('1.1'), { from: owner }).should.be.rejected
          const { logs } = await contract.setFee(foreignToHomeFee, ZERO_ADDRESS, ether('0.1'), { from: owner }).should
            .be.fulfilled

          expectEventInLogs(logs, 'FeeUpdated')
          expect(await contract.getFee(foreignToHomeFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.1'))
          expect(await contract.getFee(homeToForeignFee, ZERO_ADDRESS)).to.be.bignumber.equal(ether('0.02'))
        })

        it('should update fee value for native token', async () => {
          await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled
          await contract.setFee(homeToForeignFee, token.address, ether('0.1'), { from: owner }).should.be.rejected
          await contract.setFee(foreignToHomeFee, token.address, ether('0.2'), { from: owner }).should.be.rejected

          await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled

          await contract.setFee(homeToForeignFee, token.address, ether('0.1'), { from: user }).should.be.rejected
          await contract.setFee(homeToForeignFee, token.address, ether('1.1'), { from: owner }).should.be.rejected
          const { logs: logs1 } = await contract.setFee(homeToForeignFee, token.address, ether('0.1'), { from: owner })
            .should.be.fulfilled
          const { logs: logs2 } = await contract.setFee(foreignToHomeFee, token.address, ether('0.2'), { from: owner })
            .should.be.fulfilled

          expectEventInLogs(logs1, 'FeeUpdated')
          expectEventInLogs(logs2, 'FeeUpdated')
          expect(await contract.getFee(homeToForeignFee, token.address)).to.be.bignumber.equal(ether('0.1'))
          expect(await contract.getFee(foreignToHomeFee, token.address)).to.be.bignumber.equal(ether('0.2'))
        })

        it('should update fee value for bridged token', async () => {
          const args = [otherSideToken1, 'Test', 'TST', 18, user, value]
          const data = contract.contract.methods.deployAndHandleBridgedTokens(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

          await contract.setFee(homeToForeignFee, bridgedToken, ether('0.1'), { from: user }).should.be.rejected
          await contract.setFee(homeToForeignFee, bridgedToken, ether('1.1'), { from: owner }).should.be.rejected
          const { logs: logs1 } = await contract.setFee(homeToForeignFee, bridgedToken, ether('0.1'), { from: owner })
            .should.be.fulfilled
          const { logs: logs2 } = await contract.setFee(foreignToHomeFee, bridgedToken, ether('0.2'), { from: owner })
            .should.be.fulfilled

          expectEventInLogs(logs1, 'FeeUpdated')
          expectEventInLogs(logs2, 'FeeUpdated')
          expect(await contract.getFee(homeToForeignFee, bridgedToken)).to.be.bignumber.equal(ether('0.1'))
          expect(await contract.getFee(foreignToHomeFee, bridgedToken)).to.be.bignumber.equal(ether('0.2'))
        })
      })

      function testHomeToForeignFee(isNative) {
        it('should collect and distribute 0% fee', async () => {
          await contract.setFee(homeToForeignFee, isNative ? ZERO_ADDRESS : token.address, ZERO).should.be.fulfilled
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
          await contract.addRewardAddress(accounts[9]).should.be.fulfilled
          expect(await contract.rewardAddressCount()).to.be.bignumber.equal('2')

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
            await contract.setFee(homeToForeignFee, ZERO_ADDRESS, ZERO).should.be.fulfilled
            await token.mint(user, ether('10'), { from: owner }).should.be.fulfilled
            await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
            await token.transferAndCall(contract.address, value, '0x', { from: user }).should.be.fulfilled
          })

          it('should collect and distribute 0% fee', async () => {
            await contract.setFee(foreignToHomeFee, token.address, ZERO).should.be.fulfilled
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
            await contract.addRewardAddress(accounts[9]).should.be.fulfilled
            expect(await contract.rewardAddressCount()).to.be.bignumber.equal('2')

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
            await contract.setFee(foreignToHomeFee, ZERO_ADDRESS, ZERO).should.be.fulfilled
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
            await contract.addRewardAddress(accounts[9]).should.be.fulfilled
            expect(await contract.rewardAddressCount()).to.be.bignumber.equal('2')

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
            await contract.setFee(foreignToHomeFee, ZERO_ADDRESS, ZERO).should.be.fulfilled
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

        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('-1')

        await manager.setSenderExceptionForTokenForwardingRule(token.address, user, true, { from: user }).should.be
          .rejected
        await manager.setSenderExceptionForTokenForwardingRule(token.address, user, true, { from: owner }).should.be
          .fulfilled

        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('1')
        expect(await manager.destinationLane(token.address, user2, user2)).to.be.bignumber.equal('-1')

        await manager.setSenderExceptionForTokenForwardingRule(token.address, user, false, { from: owner }).should.be
          .fulfilled
        await manager.setReceiverExceptionForTokenForwardingRule(token.address, user, true, { from: user }).should.be
          .rejected
        await manager.setReceiverExceptionForTokenForwardingRule(token.address, user, true, { from: owner }).should.be
          .fulfilled

        expect(await manager.destinationLane(token.address, user, user)).to.be.bignumber.equal('1')
        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('-1')

        await manager.setTokenForwardingRule(token.address, false, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user2, user2)).to.be.bignumber.equal('0')

        await manager.setSenderForwardingRule(user2, true, { from: user }).should.be.rejected
        await manager.setSenderForwardingRule(user2, true, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user2, user2)).to.be.bignumber.equal('-1')

        await manager.setReceiverForwardingRule(user2, true, { from: user }).should.be.rejected
        await manager.setReceiverForwardingRule(user2, true, { from: owner }).should.be.fulfilled

        expect(await manager.destinationLane(token.address, user, user2)).to.be.bignumber.equal('-1')
      })

      it('should send a message to the manual lane', async () => {
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
        expect(events[2].returnValues.dataType).to.be.bignumber.equal('0')
        expect(events[3].returnValues.dataType).to.be.bignumber.equal('0')
        expect(events[4].returnValues.dataType).to.be.bignumber.equal('128')
        expect(events[5].returnValues.dataType).to.be.bignumber.equal('128')
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
