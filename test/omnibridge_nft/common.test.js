const HomeNFTOmnibridge = artifacts.require('HomeNFTOmnibridge')
const ForeignNFTOmnibridge = artifacts.require('ForeignNFTOmnibridge')
const EternalStorageProxy = artifacts.require('EternalStorageProxy')
const AMBMock = artifacts.require('AMBMock')
const ERC721BridgeToken = artifacts.require('ERC721BridgeToken')

const { expect } = require('chai')
const { getEvents, ether, expectEventInLogs } = require('../helpers/helpers')
const { ZERO_ADDRESS, toBN } = require('../setup')

const ZERO = toBN(0)
const exampleMessageId = '0xf308b922ab9f8a7128d9d7bc9bce22cd88b2c05c8213f0e2d8104d78e0a9ecbb'
const otherMessageId = '0x35d3818e50234655f6aebb2a1cfbf30f59568d8a4ec72066fac5a25dbe7b8121'
const failedMessageId = '0x2ebc2ccc755acc8eaf9252e19573af708d644ab63a39619adb080a3500a4ff2e'

function runTests(accounts, isHome) {
  const Mediator = isHome ? HomeNFTOmnibridge : ForeignNFTOmnibridge
  const modifyName = (name) => name + (isHome ? ' on xDai' : ' on Mainnet')
  const otherSideMediator = '0x1e33FBB006F47F78704c954555a5c52C2A7f409D'
  const otherSideToken1 = '0xAfb77d544aFc1e2aD3dEEAa20F3c80859E7Fc3C9'
  const otherSideToken2 = '0x876bD892b01D1c9696D873f74cbeF8fc9Bfb1142'

  let contract
  let token
  let ambBridgeContract
  let currentDay
  let tokenImage
  const owner = accounts[0]
  const user = accounts[1]
  const user2 = accounts[2]

  const mintNewNFT = (() => {
    let tokenId = 100
    return async () => {
      await token.mint(user, tokenId)
      return tokenId++
    }
  })()

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
      opts.dailyLimit || 20,
      opts.executionDailyLimit || 10,
      opts.requestGasLimit || 1000000,
      opts.owner || owner,
      opts.tokenImage || tokenImage.address,
    ]
    return contract.initialize(...args)
  }

  const sendFunctions = [
    async function noAlternativeReceiver(tokenId) {
      const id = tokenId || (await mintNewNFT())
      const method = token.methods['safeTransferFrom(address,address,uint256)']
      return method(user, contract.address, id, { from: user }).then(() => user)
    },
    async function sameAlternativeReceiver(tokenId) {
      const id = tokenId || (await mintNewNFT())
      const method = token.methods['safeTransferFrom(address,address,uint256,bytes)']
      return method(user, contract.address, id, user, { from: user }).then(() => user)
    },
    async function differentAlternativeReceiver(tokenId) {
      const id = tokenId || (await mintNewNFT())
      const method = token.methods['safeTransferFrom(address,address,uint256,bytes)']
      return method(user, contract.address, id, user2, { from: user }).then(() => user2)
    },
    async function simpleRelayToken1(tokenId) {
      const id = tokenId || (await mintNewNFT())
      await token.approve(contract.address, id, { from: user }).should.be.fulfilled
      const method = contract.methods['relayToken(address,uint256)']
      return method(token.address, id, { from: user }).then(() => user)
    },
    async function simpleRelayToken2(tokenId) {
      const id = tokenId || (await mintNewNFT())
      await token.approve(contract.address, id, { from: user }).should.be.fulfilled
      const method = contract.methods['relayToken(address,address,uint256)']
      return method(token.address, user, id, { from: user }).then(() => user)
    },
    async function relayTokenWithAlternativeReceiver(tokenId) {
      const id = tokenId || (await mintNewNFT())
      await token.approve(contract.address, id, { from: user }).should.be.fulfilled
      const method = contract.methods['relayToken(address,address,uint256)']
      return method(token.address, user2, id, { from: user }).then(() => user2)
    },
  ]

  before(async () => {
    tokenImage = await ERC721BridgeToken.new('TEST', 'TST', owner)
  })

  beforeEach(async () => {
    contract = await Mediator.new()
    ambBridgeContract = await AMBMock.new()
    token = await ERC721BridgeToken.new('TEST', 'TST', owner)
    currentDay = await contract.getCurrentDay()
  })

  describe('getBridgeMode', () => {
    it('should return mediator mode and interface', async function () {
      const bridgeModeHash = '0xca7fc3dc' // 4 bytes of keccak256('multi-nft-to-nft-amb')
      expect(await contract.getBridgeMode()).to.be.equal(bridgeModeHash)

      const { major, minor, patch } = await contract.getBridgeInterfacesVersion()
      major.should.be.bignumber.gte(ZERO)
      minor.should.be.bignumber.gte(ZERO)
      patch.should.be.bignumber.gte(ZERO)
    })
  })

  describe('initialize', () => {
    it('should initialize parameters', async () => {
      // Given
      expect(await contract.isInitialized()).to.be.equal(false)
      expect(await contract.bridgeContract()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.mediatorContractOnOtherSide()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
      expect(await contract.requestGasLimit()).to.be.bignumber.equal(ZERO)
      expect(await contract.owner()).to.be.equal(ZERO_ADDRESS)
      expect(await contract.tokenImage()).to.be.equal(ZERO_ADDRESS)

      // When
      // not valid bridge address
      await initialize({ ambContract: ZERO_ADDRESS }).should.be.rejected

      // maxGasPerTx > bridge maxGasPerTx
      await initialize({ requestGasLimit: ether('1') }).should.be.rejected

      // not valid owner
      await initialize({ owner: ZERO_ADDRESS }).should.be.rejected

      // token factory is not a contract
      await initialize({ tokenImage: owner }).should.be.rejected

      const { logs } = await initialize().should.be.fulfilled

      // already initialized
      await initialize().should.be.rejected

      // Then
      expect(await contract.isInitialized()).to.be.equal(true)
      expect(await contract.bridgeContract()).to.be.equal(ambBridgeContract.address)
      expect(await contract.mediatorContractOnOtherSide()).to.be.equal(otherSideMediator)
      expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal('20')
      expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal('10')
      expect(await contract.requestGasLimit()).to.be.bignumber.equal('1000000')
      expect(await contract.owner()).to.be.equal(owner)
      expect(await contract.tokenImage()).to.be.equal(tokenImage.address)

      expectEventInLogs(logs, 'ExecutionDailyLimitChanged', { token: ZERO_ADDRESS, newLimit: '10' })
      expectEventInLogs(logs, 'DailyLimitChanged', { token: ZERO_ADDRESS, newLimit: '20' })
    })
  })

  describe('afterInitialization', () => {
    beforeEach(async () => {
      await initialize().should.be.fulfilled

      const initialEvents = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
      expect(initialEvents.length).to.be.equal(0)
    })

    describe('update mediator parameters', () => {
      describe('limits', () => {
        it('should allow to update default daily limits', async () => {
          await contract.setDailyLimit(ZERO_ADDRESS, 10, { from: user }).should.be.rejected
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, 5, { from: user }).should.be.rejected
          await contract.setDailyLimit(ZERO_ADDRESS, 10, { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, 5, { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal('10')
          expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal('5')

          await contract.setDailyLimit(ZERO_ADDRESS, ZERO, { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO, { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
          expect(await contract.executionDailyLimit(ZERO_ADDRESS)).to.be.bignumber.equal(ZERO)
        })

        it('should only allow to update parameters for known tokens', async () => {
          await contract.setDailyLimit(token.address, 10, { from: owner }).should.be.rejected
          await contract.setExecutionDailyLimit(token.address, 5, { from: owner }).should.be.rejected

          await token.safeTransferFrom(user, contract.address, await mintNewNFT(), { from: user }).should.be.fulfilled

          await contract.setDailyLimit(token.address, 10, { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(token.address, 5, { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal('10')
          expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal('5')

          const args = [otherSideToken1, 'Test', 'TST', user, 1]
          const data = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)
          const bridgedToken = await contract.bridgedTokenAddress(otherSideToken1)

          await contract.setDailyLimit(bridgedToken, 10, { from: owner }).should.be.fulfilled
          await contract.setExecutionDailyLimit(bridgedToken, 5, { from: owner }).should.be.fulfilled

          expect(await contract.dailyLimit(bridgedToken)).to.be.bignumber.equal('10')
          expect(await contract.executionDailyLimit(bridgedToken)).to.be.bignumber.equal('5')
        })
      })
    })

    describe('native tokens', () => {
      describe('initialization', () => {
        it(`should initialize limits`, async () => {
          await sendFunctions[0]().should.be.fulfilled

          expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal('20')
          expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal('10')
        })
      })

      describe('tokens relay', () => {
        for (const send of sendFunctions) {
          it(`should make calls to deployAndHandleBridgedNFT and handleBridgedNFT using ${send.name}`, async () => {
            const tokenId1 = await mintNewNFT()
            const receiver = await send(tokenId1).should.be.fulfilled

            let events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(1)
            const { data, messageId, dataType, executor } = events[0].returnValues
            expect(data.slice(2, 10)).to.be.equal('bb5153cf')
            const args = web3.eth.abi.decodeParameters(
              ['address', 'string', 'string', 'address', 'uint256'],
              data.slice(10)
            )
            expect(executor).to.be.equal(otherSideMediator)
            expect(args[0]).to.be.equal(token.address)
            expect(args[1]).to.be.equal(await token.name())
            expect(args[2]).to.be.equal(await token.symbol())
            expect(args[3]).to.be.equal(receiver)
            expect(args[4]).to.be.equal(tokenId1.toString())
            expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal(messageId)

            const tokenId2 = await mintNewNFT()
            await send(tokenId2).should.be.fulfilled

            events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data: data2, dataType: dataType2 } = events[1].returnValues
            expect(data2.slice(2, 10)).to.be.equal('f4a67607')
            const args2 = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data2.slice(10))
            expect(args2[0]).to.be.equal(token.address)
            expect(args2[1]).to.be.equal(receiver)
            expect(args2[2]).to.be.equal(tokenId2.toString())

            expect(dataType).to.be.equal('0')
            expect(dataType2).to.be.equal('0')
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal('2')
            expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(true)
            expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(true)
            expect(await contract.isTokenRegistered(token.address)).to.be.equal(true)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('2')

            const depositEvents = await getEvents(contract, { event: 'TokensBridgingInitiated' })
            expect(depositEvents.length).to.be.equal(2)
            expect(depositEvents[0].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[0].returnValues.sender).to.be.equal(user)
            expect(depositEvents[0].returnValues.tokenId).to.be.equal(tokenId1.toString())
            expect(depositEvents[0].returnValues.messageId).to.include('0x11223344')
            expect(depositEvents[1].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[1].returnValues.sender).to.be.equal(user)
            expect(depositEvents[1].returnValues.tokenId).to.be.equal(tokenId2.toString())
            expect(depositEvents[1].returnValues.messageId).to.include('0x11223344')
          })
        }

        it('should respect global shutdown', async () => {
          await contract.setDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled
          for (const send of sendFunctions) {
            await send().should.be.rejected
          }
          await contract.setDailyLimit(ZERO_ADDRESS, 10).should.be.fulfilled
          for (const send of sendFunctions) {
            await send().should.be.fulfilled
          }
        })

        it('should respect limits', async () => {
          await contract.setDailyLimit(ZERO_ADDRESS, 3).should.be.fulfilled
          await sendFunctions[0]().should.be.fulfilled
          await sendFunctions[0]().should.be.fulfilled
          await sendFunctions[0]().should.be.fulfilled
          await sendFunctions[0]().should.be.rejected
        })

        describe('fixFailedMessage', () => {
          for (const send of sendFunctions) {
            it(`should fix tokens locked via ${send.name}`, async () => {
              // User transfer tokens twice
              const tokenId1 = await mintNewNFT()
              const tokenId2 = await mintNewNFT()
              await send(tokenId1)
              await send(tokenId2)

              expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('2')
              expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(true)
              expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(true)

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
              expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('1')
              expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId2)).to.be.equal(true)
              expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal(transferMessageId1)

              expect(await executeMessageCall(otherMessageId, fixData1)).to.be.equal(true)
              expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('0')
              expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(false)
              expect(await contract.messageFixed(transferMessageId1)).to.be.equal(true)
              expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal('0x'.padEnd(66, '0'))
              expect(await contract.dailyLimit(token.address)).to.be.bignumber.equal('0')
              expect(await contract.executionDailyLimit(token.address)).to.be.bignumber.equal('0')

              const event = await getEvents(contract, { event: 'FailedMessageFixed' })
              expect(event.length).to.be.equal(2)
              expect(event[0].returnValues.messageId).to.be.equal(transferMessageId2)
              expect(event[0].returnValues.token).to.be.equal(token.address)
              expect(event[0].returnValues.recipient).to.be.equal(user)
              expect(event[0].returnValues.value).to.be.equal(tokenId2.toString())
              expect(event[1].returnValues.messageId).to.be.equal(transferMessageId1)
              expect(event[1].returnValues.token).to.be.equal(token.address)
              expect(event[1].returnValues.recipient).to.be.equal(user)
              expect(event[1].returnValues.value).to.be.equal(tokenId1.toString())

              expect(await executeMessageCall(failedMessageId, fixData1)).to.be.equal(false)
              expect(await executeMessageCall(failedMessageId, fixData2)).to.be.equal(false)
            })
          }
        })

        describe('fixMediatorBalance', () => {
          let tokenId1
          let tokenId2
          let tokenId3
          beforeEach(async () => {
            const storageProxy = await EternalStorageProxy.new()
            await storageProxy.upgradeTo('1', contract.address).should.be.fulfilled
            contract = await Mediator.at(storageProxy.address)

            tokenId1 = await mintNewNFT()
            tokenId2 = await mintNewNFT()
            tokenId3 = await mintNewNFT()

            await initialize().should.be.fulfilled

            await sendFunctions[0](tokenId1).should.be.fulfilled
            await token.transferFrom(user, contract.address, tokenId2, { from: user }).should.be.fulfilled
            await token.transferFrom(user, contract.address, tokenId3, { from: user }).should.be.fulfilled

            expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(true)
            expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(false)
            expect(await contract.mediatorOwns(token.address, tokenId3)).to.be.equal(false)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('3')
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal('1')
            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(1)
          })

          it('should allow to fix extra mediator balance', async () => {
            await contract.setDailyLimit(token.address, 2).should.be.fulfilled

            await contract.fixMediatorBalance(token.address, owner, tokenId2, { from: user }).should.be.rejected
            await contract.fixMediatorBalance(ZERO_ADDRESS, owner, tokenId2, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, ZERO_ADDRESS, tokenId2, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, owner, tokenId1, { from: owner }).should.be.rejected
            await contract.fixMediatorBalance(token.address, owner, tokenId2, { from: owner }).should.be.fulfilled
            await contract.fixMediatorBalance(token.address, owner, tokenId2, { from: owner }).should.be.rejected

            expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(true)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('3')
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal('2')
            const events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data, dataType, executor } = events[1].returnValues
            expect(data.slice(2, 10)).to.be.equal('f4a67607')
            const args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data.slice(10))
            expect(executor).to.be.equal(otherSideMediator)
            expect(dataType).to.be.bignumber.equal('0')
            expect(args[0]).to.be.equal(token.address)
            expect(args[1]).to.be.equal(owner)
            expect(args[2]).to.be.bignumber.equal(tokenId2.toString())
          })

          it('should allow to fix extra mediator balance with respect to limits', async () => {
            await contract.setDailyLimit(token.address, 2).should.be.fulfilled

            await contract.fixMediatorBalance(token.address, owner, tokenId2, { from: owner }).should.be.fulfilled
            await contract.fixMediatorBalance(token.address, owner, tokenId3, { from: owner }).should.be.rejected

            await contract.setDailyLimit(token.address, 5).should.be.fulfilled

            await contract.fixMediatorBalance(token.address, owner, tokenId3, { from: owner }).should.be.fulfilled

            expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(true)
            expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(true)
            expect(await contract.mediatorOwns(token.address, tokenId3)).to.be.equal(true)
          })
        })
      })

      describe('handleNativeNFT', () => {
        it('should unlock tokens on message from amb', async () => {
          const tokenId1 = await mintNewNFT()
          const tokenId2 = await mintNewNFT()
          await sendFunctions[0](tokenId1).should.be.fulfilled
          await sendFunctions[0](tokenId2).should.be.fulfilled

          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('2')
          expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(true)
          expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(true)

          // can't be called by user
          await contract.handleNativeNFT(token.address, user, tokenId1, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.handleNativeNFT(token.address, user, tokenId1, { from: owner }).should.be.rejected

          const data = await contract.contract.methods.handleNativeNFT(token.address, user, tokenId1).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(token.address, currentDay)).to.be.bignumber.equal('1')
          expect(await contract.mediatorOwns(token.address, tokenId1)).to.be.equal(false)
          expect(await contract.mediatorOwns(token.address, tokenId2)).to.be.equal(true)
          expect(await token.balanceOf(user)).to.be.bignumber.equal('1')
          expect(await token.balanceOf(contract.address)).to.be.bignumber.equal('1')

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(1)
          expect(event[0].returnValues.token).to.be.equal(token.address)
          expect(event[0].returnValues.recipient).to.be.equal(user)
          expect(event[0].returnValues.tokenId).to.be.equal(tokenId1.toString())
          expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should not allow to use unregistered tokens', async () => {
          const otherToken = await ERC721BridgeToken.new('Test', 'TST', owner)
          await otherToken.mint(user, 1).should.be.fulfilled
          await otherToken.transferFrom(user, contract.address, 1, { from: user }).should.be.fulfilled

          const data = await contract.contract.methods.handleNativeNFT(otherToken.address, user, 1).encodeABI()

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          const tokenId1 = await mintNewNFT()
          await sendFunctions[0](tokenId1).should.be.fulfilled

          const data = await contract.contract.methods.handleNativeNFT(token.address, user, tokenId1).encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, 10).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('requestFailedMessageFix', () => {
        it('should allow to request a failed message fix', async () => {
          const msgData = contract.contract.methods.handleNativeNFT(token.address, user, 1).encodeABI()
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
          const tokenId = await mintNewNFT()
          const msgData = contract.contract.methods.handleNativeNFT(token.address, user, tokenId).encodeABI()
          await sendFunctions[0](tokenId).should.be.fulfilled

          expect(await executeMessageCall(exampleMessageId, msgData)).to.be.equal(true)

          await contract.requestFailedMessageFix(exampleMessageId).should.be.rejected
        })

        it('should be the receiver of the failed transaction', async () => {
          const msgData = contract.contract.methods.handleNativeNFT(token.address, user, 1).encodeABI()
          expect(
            await executeMessageCall(failedMessageId, msgData, { executor: ambBridgeContract.address })
          ).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.rejected
        })

        it('message sender should be mediator from other side', async () => {
          const msgData = contract.contract.methods.handleNativeNFT(token.address, user, 1).encodeABI()
          expect(await executeMessageCall(failedMessageId, msgData, { messageSender: owner })).to.be.equal(false)

          await contract.requestFailedMessageFix(failedMessageId).should.be.rejected
        })

        it('should allow to request a fix multiple times', async () => {
          const msgData = contract.contract.methods.handleNativeNFT(token.address, user, 1).encodeABI()
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
          await contract.setExecutionDailyLimit(ZERO_ADDRESS, 10).should.be.fulfilled
          const args = [otherSideToken1, 'Test', 'TST', user, 1]
          const deployData = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()
          expect(await executeMessageCall(exampleMessageId, deployData)).to.be.equal(true)
          token = await ERC721BridgeToken.at(await contract.bridgedTokenAddress(otherSideToken1))
        })

        for (const send of sendFunctions) {
          it(`should make calls to handleNativeNFT using ${send.name} for bridged token`, async () => {
            const bridgeData = contract.contract.methods.handleBridgedNFT(otherSideToken1, user, 2).encodeABI()
            expect(await executeMessageCall(exampleMessageId, bridgeData)).to.be.equal(true)
            const receiver = await send(1).should.be.fulfilled

            let events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(1)
            const { data, dataType, executor } = events[0].returnValues
            expect(data.slice(2, 10)).to.be.equal('e3ae3984')
            const args = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data.slice(10))
            expect(executor).to.be.equal(otherSideMediator)
            expect(args[0]).to.be.equal(otherSideToken1)
            expect(args[1]).to.be.equal(receiver)
            expect(args[2]).to.be.equal('1')
            expect(await contract.tokenRegistrationMessageId(otherSideToken1)).to.be.equal('0x'.padEnd(66, '0'))
            expect(await contract.tokenRegistrationMessageId(token.address)).to.be.equal('0x'.padEnd(66, '0'))

            await send(2).should.be.fulfilled

            events = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
            expect(events.length).to.be.equal(2)
            const { data: data2, dataType: dataType2 } = events[1].returnValues
            expect(data2.slice(2, 10)).to.be.equal('e3ae3984')
            const args2 = web3.eth.abi.decodeParameters(['address', 'address', 'uint256'], data2.slice(10))
            expect(args2[0]).to.be.equal(otherSideToken1)
            expect(args2[1]).to.be.equal(receiver)
            expect(args2[2]).to.be.equal('2')

            expect(dataType).to.be.equal('0')
            expect(dataType2).to.be.equal('0')
            expect(await contract.totalSpentPerDay(token.address, currentDay)).to.be.bignumber.equal('2')
            expect(await contract.isTokenRegistered(token.address)).to.be.equal(true)
            expect(await token.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

            const depositEvents = await getEvents(contract, { event: 'TokensBridgingInitiated' })
            expect(depositEvents.length).to.be.equal(2)
            expect(depositEvents[0].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[0].returnValues.sender).to.be.equal(user)
            expect(depositEvents[0].returnValues.tokenId).to.be.equal('1')
            expect(depositEvents[0].returnValues.messageId).to.include('0x11223344')
            expect(depositEvents[1].returnValues.token).to.be.equal(token.address)
            expect(depositEvents[1].returnValues.sender).to.be.equal(user)
            expect(depositEvents[1].returnValues.tokenId).to.be.equal('2')
            expect(depositEvents[1].returnValues.messageId).to.include('0x11223344')
          })
        }

        it('should respect global shutdown', async () => {
          await contract.setDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled
          for (const send of sendFunctions) {
            await send(1).should.be.rejected
          }
          await contract.setDailyLimit(ZERO_ADDRESS, 10).should.be.fulfilled
          await sendFunctions[0](1).should.be.fulfilled
        })

        it('should respect limits', async () => {
          const bridgeData1 = contract.contract.methods.handleBridgedNFT(otherSideToken1, user, 2).encodeABI()
          const bridgeData2 = contract.contract.methods.handleBridgedNFT(otherSideToken1, user, 3).encodeABI()
          expect(await executeMessageCall(exampleMessageId, bridgeData1)).to.be.equal(true)
          expect(await executeMessageCall(exampleMessageId, bridgeData2)).to.be.equal(true)

          await contract.setDailyLimit(token.address, 2).should.be.fulfilled
          await sendFunctions[0](1).should.be.fulfilled
          await sendFunctions[0](2).should.be.fulfilled
          await sendFunctions[0](3).should.be.rejected
        })

        describe('fixFailedMessage', () => {
          for (const send of sendFunctions) {
            it(`should fix tokens locked via ${send.name}`, async () => {
              // User transfer tokens
              await send(1)

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
              expect(await token.ownerOf(1)).to.be.equal(user)
              expect(await contract.messageFixed(transferMessageId)).to.be.equal(true)

              const event = await getEvents(contract, { event: 'FailedMessageFixed' })
              expect(event.length).to.be.equal(1)
              expect(event[0].returnValues.messageId).to.be.equal(transferMessageId)
              expect(event[0].returnValues.token).to.be.equal(token.address)
              expect(event[0].returnValues.recipient).to.be.equal(user)
              expect(event[0].returnValues.value).to.be.equal('1')

              expect(await executeMessageCall(failedMessageId, fixData)).to.be.equal(false)
            })
          }
        })
      })

      describe('deployAndHandleBridgedNFT', () => {
        it('should deploy contract and mint tokens on first message from amb', async () => {
          // can't be called by user
          const args = [otherSideToken1, 'Test', 'TST', user, 1]
          await contract.deployAndHandleBridgedNFT(...args, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.deployAndHandleBridgedNFT(...args, { from: owner }).should.be.rejected

          const data = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const { nativeToken, bridgedToken } = events[0].returnValues
          expect(nativeToken).to.be.equal(otherSideToken1)
          const deployedToken = await ERC721BridgeToken.at(bridgedToken)

          expect(await deployedToken.name()).to.be.equal(modifyName('Test'))
          expect(await deployedToken.symbol()).to.be.equal('TST')
          expect(await contract.nativeTokenAddress(bridgedToken)).to.be.equal(nativeToken)
          expect(await contract.bridgedTokenAddress(nativeToken)).to.be.equal(bridgedToken)
          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal('1')
          expect(await deployedToken.ownerOf(1)).to.be.bignumber.equal(user)
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(1)
          expect(event[0].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[0].returnValues.recipient).to.be.equal(user)
          expect(event[0].returnValues.tokenId).to.be.equal('1')
          expect(event[0].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should do not deploy new contract if token is already deployed', async () => {
          const args = [otherSideToken1, 'Test', 'TST', user]
          const data1 = contract.contract.methods.deployAndHandleBridgedNFT(...args, 1).encodeABI()
          const data2 = contract.contract.methods.deployAndHandleBridgedNFT(...args, 2).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data1)).to.be.equal(true)

          expect(await executeMessageCall(otherSideToken1, data2)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(2)
        })

        it('should modify used symbol instead of name if empty', async () => {
          const args = [otherSideToken1, '', 'TST', user, 1]
          const data = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const deployedToken = await ERC721BridgeToken.at(await contract.bridgedTokenAddress(otherSideToken1))
          expect(await deployedToken.name()).to.be.equal(modifyName('TST'))
          expect(await deployedToken.symbol()).to.be.equal('TST')
        })

        it('should modify used name instead of symbol if empty', async () => {
          const args = [otherSideToken1, 'Test', '', user, 1]
          const data = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const deployedToken = await ERC721BridgeToken.at(await contract.bridgedTokenAddress(otherSideToken1))
          expect(await deployedToken.name()).to.be.equal(modifyName('Test'))
          expect(await deployedToken.symbol()).to.be.equal('Test')
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          const args = [otherSideToken1, 'Test', 'TST', user, 1]
          const data = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, 10).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('handleBridgedNFT', () => {
        let deployedToken
        beforeEach(async () => {
          const args = [otherSideToken1, 'Test', 'TST', user, 1]
          const data = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          const events = await getEvents(contract, { event: 'NewTokenRegistered' })
          expect(events.length).to.be.equal(1)
          const { nativeToken, bridgedToken } = events[0].returnValues
          expect(nativeToken).to.be.equal(otherSideToken1)
          deployedToken = await ERC721BridgeToken.at(bridgedToken)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal('1')
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal('1')
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)
          expect(await contract.mediatorOwns(deployedToken.address, 1)).to.be.equal(false)
        })

        it('should mint existing tokens on repeated messages from amb', async () => {
          // can't be called by user
          await contract.handleBridgedNFT(otherSideToken1, user, 2, { from: user }).should.be.rejected

          // can't be called by owner
          await contract.handleBridgedNFT(otherSideToken1, user, 2, { from: owner }).should.be.rejected

          const data = contract.contract.methods.handleBridgedNFT(otherSideToken1, user, 2).encodeABI()

          // message must be generated by mediator contract on the other network
          expect(await executeMessageCall(failedMessageId, data, { messageSender: owner })).to.be.equal(false)

          expect(await executeMessageCall(exampleMessageId, data)).to.be.equal(true)

          expect(await contract.totalExecutedPerDay(deployedToken.address, currentDay)).to.be.bignumber.equal('2')
          expect(await contract.mediatorOwns(deployedToken.address, 2)).to.be.equal(false)
          expect(await deployedToken.balanceOf(user)).to.be.bignumber.equal('2')
          expect(await deployedToken.balanceOf(contract.address)).to.be.bignumber.equal(ZERO)

          const event = await getEvents(contract, { event: 'TokensBridged' })
          expect(event.length).to.be.equal(2)
          expect(event[1].returnValues.token).to.be.equal(deployedToken.address)
          expect(event[1].returnValues.recipient).to.be.equal(user)
          expect(event[1].returnValues.tokenId).to.be.equal('2')
          expect(event[1].returnValues.messageId).to.be.equal(exampleMessageId)
        })

        it('should not allow to process unknown tokens', async () => {
          const data = contract.contract.methods.handleBridgedNFT(otherSideToken2, user, 2).encodeABI()

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)
        })

        it('should not allow to operate when global shutdown is enabled', async () => {
          const data = contract.contract.methods.handleBridgedNFT(otherSideToken1, user, 2).encodeABI()

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, ZERO).should.be.fulfilled

          expect(await executeMessageCall(failedMessageId, data)).to.be.equal(false)

          await contract.setExecutionDailyLimit(ZERO_ADDRESS, 10).should.be.fulfilled

          expect(await executeMessageCall(otherMessageId, data)).to.be.equal(true)
        })
      })

      describe('requestFailedMessageFix', () => {
        let msgData
        beforeEach(() => {
          const args = [otherSideToken1, 'Test', 'TST', user, 1]
          msgData = contract.contract.methods.deployAndHandleBridgedNFT(...args).encodeABI()
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
}

contract('ForeignNFTOmnibridge', (accounts) => {
  runTests(accounts, false)
})

contract('HomeNFTOmnibridge', (accounts) => {
  runTests(accounts, true)
})
