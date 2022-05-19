const HomeOmnibridge = artifacts.require('HomeOmnibridge')
const AMBMock = artifacts.require('AMBMock')
const TokenFactory = artifacts.require('TokenFactory')
const OmnibridgeSubsidizeHelper = artifacts.require('OmnibridgeSubsidizeHelper')
const OmnibridgeFeeManager = artifacts.require('OmnibridgeFeeManager')
const MultiTokenForwardingRulesManager = artifacts.require('MultiTokenForwardingRulesManager')
const WETH = artifacts.require('WETH')

const { expect } = require('chai')
const { getEvents, ether } = require('../helpers/helpers')
const { requirePrecompiled, ZERO_ADDRESS, toWei } = require('../setup')

const oneEther = ether('1')
const dailyLimit = ether('10')
const maxPerTx = oneEther
const minPerTx = ether('0.01')
const executionDailyLimit = dailyLimit
const executionMaxPerTx = maxPerTx

contract.only('OmnibridgeSubsidizeHelper', (accounts) => {
  let token
  let mediator
  let ambBridgeContract
  let feeManager
  let forwardingManager
  let helper
  const owner = accounts[0]
  const user = accounts[1]
  const ONE_PERCENT_FEE = {
    percentage: toWei('0.01'),
    minFee: toWei('0.05'),
    maxFee: toWei('100'),
  }

  beforeEach(async () => {
    const PermittableToken = await requirePrecompiled('PermittableToken')

    token = await PermittableToken.new('TEST', 'TST', 18, 1337)
    const tokenFactory = await TokenFactory.new(owner, token.address)
    mediator = await HomeOmnibridge.new(' on Testnet')
    ambBridgeContract = await AMBMock.new()
    forwardingManager = await MultiTokenForwardingRulesManager.new(owner)
    await mediator.initialize(
      ambBridgeContract.address,
      mediator.address,
      [dailyLimit, maxPerTx, minPerTx],
      [executionDailyLimit, executionMaxPerTx],
      ZERO_ADDRESS,
      owner,
      tokenFactory.address,
      ZERO_ADDRESS,
      forwardingManager.address
    )
    helper = await OmnibridgeSubsidizeHelper.new(mediator.address, owner)
    feeManager = await OmnibridgeFeeManager.new(helper.address, owner, [owner], ONE_PERCENT_FEE, ONE_PERCENT_FEE)
    await helper.setFeeManager(feeManager.address)
    await forwardingManager.setSenderForwardingRule(helper.address, true)

    await token.mint(user, ether('100'))
    await token.approve(helper.address, ether('100'), { from: user })
    await helper.enableToken(token.address, true)
  })

  it('relayTokens', async () => {
    await helper.methods['relayTokens(address,address,uint256)'](token.address, accounts[2], oneEther, { from: user })
    await helper.methods['relayTokens(address,uint256)'](token.address, oneEther, { from: user })
    await helper.relayTokensAndCall(token.address, accounts[2], oneEther, '0x55667788', { from: user })
    await token.transferAndCall(helper.address, oneEther, accounts[2], { from: user })
    await token.transferAndCall(mediator.address, oneEther, accounts[2], { from: user })

    const depositEvents = await getEvents(mediator, { event: 'TokensBridgingInitiated' })
    expect(depositEvents.length).to.be.equal(5)
    for (let i = 0; i < 5; i++) {
      expect(depositEvents[i].returnValues.token).to.be.equal(token.address)
      expect(depositEvents[i].returnValues.sender).to.be.equal(i === 4 ? user : helper.address)
      expect(depositEvents[i].returnValues.value).to.be.equal(ether(i === 4 ? '1' : '0.95').toString())
      expect(depositEvents[i].returnValues.messageId).to.include('0x11223344')
    }
    const ambEvents = await getEvents(ambBridgeContract, { event: 'MockedEvent' })
    expect(ambEvents.length).to.be.equal(5)
    expect(ambEvents[0].returnValues.data).to.include(accounts[2].slice(2).toLowerCase())
    expect(ambEvents[1].returnValues.data).to.include(user.slice(2).toLowerCase())
    expect(ambEvents[2].returnValues.data).to.include(accounts[2].slice(2).toLowerCase())
    expect(ambEvents[3].returnValues.data).to.include(accounts[2].slice(2).toLowerCase())
    expect(ambEvents[4].returnValues.data).to.include(accounts[2].slice(2).toLowerCase())
    expect(ambEvents[2].returnValues.data).to.include('55667788')
    expect(ambEvents[0].returnValues.dataType).to.be.bignumber.equal('0')
    expect(ambEvents[1].returnValues.dataType).to.be.bignumber.equal('0')
    expect(ambEvents[2].returnValues.dataType).to.be.bignumber.equal('0')
    expect(ambEvents[3].returnValues.dataType).to.be.bignumber.equal('0')
    expect(ambEvents[4].returnValues.dataType).to.be.bignumber.equal('128')
    expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('0.2'))
  })

  it('claimTokens', async () => {
    const wethToken = await WETH.new()
    await wethToken.deposit({ value: oneEther })
    await wethToken.transfer(helper.address, oneEther)

    await helper.claimTokens(wethToken.address, user, { from: user }).should.be.rejected
    await helper.claimTokens(wethToken.address, user, { from: owner })

    expect(await wethToken.balanceOf(user)).to.be.bignumber.equal(oneEther)
  })
})
