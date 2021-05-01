const ForeignOmnibridge = artifacts.require('ForeignOmnibridge')
const AMBMock = artifacts.require('AMBMock')
const TokenFactory = artifacts.require('TokenFactory')
const WETHOmnibridgeRouter = artifacts.require('WETHOmnibridgeRouter')
const WETH = artifacts.require('WETH')

const { expect } = require('chai')
const { getEvents, ether } = require('../helpers/helpers')
const { toBN, requirePrecompiled } = require('../setup')

const oneEther = ether('1')
const dailyLimit = ether('2.5')
const maxPerTx = oneEther
const minPerTx = ether('0.01')
const executionDailyLimit = dailyLimit
const executionMaxPerTx = maxPerTx

contract('WETHOmnibridgeRouter', (accounts) => {
  let token
  let mediator
  let ambBridgeContract
  const owner = accounts[0]
  const user = accounts[1]

  beforeEach(async () => {
    const PermittableToken = await requirePrecompiled('PermittableToken')

    const tokenImage = await PermittableToken.new('TEST', 'TST', 18, 1337)
    const tokenFactory = await TokenFactory.new(owner, tokenImage.address)
    mediator = await ForeignOmnibridge.new(' on Testnet')
    ambBridgeContract = await AMBMock.new()
    await mediator.initialize(
      ambBridgeContract.address,
      mediator.address,
      [dailyLimit, maxPerTx, minPerTx],
      [executionDailyLimit, executionMaxPerTx],
      1000000,
      owner,
      tokenFactory.address
    )

    token = await WETH.new()
  })

  it('wrapAndRelayTokens', async () => {
    const WETHRouter = await WETHOmnibridgeRouter.new(mediator.address, token.address, owner)

    const method1 = WETHRouter.methods['wrapAndRelayTokens()']
    const method2 = WETHRouter.methods['wrapAndRelayTokens(address)']
    await method1({ from: user, value: oneEther }).should.be.fulfilled
    await method2(accounts[2], { from: user, value: oneEther }).should.be.fulfilled
    await method1({ from: user, value: oneEther }).should.be.rejected

    const depositEvents = await getEvents(mediator, { event: 'TokensBridgingInitiated' })
    expect(depositEvents.length).to.be.equal(2)
    for (const event of depositEvents) {
      expect(event.returnValues.token).to.be.equal(token.address)
      expect(event.returnValues.sender).to.be.equal(WETHRouter.address)
      expect(event.returnValues.value).to.be.equal(oneEther.toString())
      expect(event.returnValues.messageId).to.include('0x11223344')
    }
    const ambEvents = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
    expect(ambEvents.length).to.be.equal(2)
    expect(ambEvents[0].returnValues.data).to.include(user.slice(2).toLowerCase())
    expect(ambEvents[1].returnValues.data).to.include(accounts[2].slice(2).toLowerCase())
  })

  it('onTokenBridged', async () => {
    const stubMediator = accounts[2]
    const WETHRouter = await WETHOmnibridgeRouter.new(stubMediator, token.address, owner)
    await token.deposit({ value: oneEther })
    await token.transfer(WETHRouter.address, oneEther).should.be.fulfilled

    const balanceBefore = toBN(await web3.eth.getBalance(user))

    await WETHRouter.onTokenBridged(owner, oneEther, user, { from: stubMediator }).should.be.rejected
    await WETHRouter.onTokenBridged(token.address, oneEther, '0x', { from: stubMediator }).should.be.rejected
    await WETHRouter.onTokenBridged(token.address, oneEther, user, { from: owner }).should.be.rejected
    await WETHRouter.onTokenBridged(token.address, oneEther, user, { from: stubMediator }).should.be.fulfilled

    const balanceAfter = toBN(await web3.eth.getBalance(user))

    expect(balanceAfter).to.be.bignumber.equal(balanceBefore.add(oneEther).toString())
  })

  it('claimTokens', async () => {
    const WETHRouter = await WETHOmnibridgeRouter.new(mediator.address, token.address, owner)
    await token.deposit({ value: oneEther })
    await token.transfer(WETHRouter.address, oneEther).should.be.fulfilled

    await WETHRouter.claimTokens(token.address, user, { from: user }).should.be.rejected
    await WETHRouter.claimTokens(token.address, user, { from: owner }).should.be.fulfilled

    expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther.toString())
  })
})
