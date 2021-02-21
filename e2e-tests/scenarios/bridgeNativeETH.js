const assert = require('assert')
const { toWei, toBN, ZERO_ADDRESS } = require('../utils')

async function run({ foreign, home, users }) {
  console.log('Bridging Native Foreign ETH to Home chain')
  const { WETH, WETHRouter } = foreign
  const value = toWei('0.1')

  console.log('Sending 0.1 ETH to the Foreign Router')
  const receipt1 = await WETHRouter.methods.wrapAndRelayTokens(users[0]).send({ value })
  const relayTxHash1 = await home.waitUntilProcessed(receipt1)
  const bridgedToken = await home.getBridgedToken(WETH)

  await home.checkTransfer(relayTxHash1, bridgedToken, ZERO_ADDRESS, users[0], home.reduceByForeignFee(value))

  console.log('\nSending 0.1 more ETH to the Foreign Router')
  const receipt2 = await WETHRouter.methods.wrapAndRelayTokens(users[0]).send({ value })
  const relayTxHash2 = await home.waitUntilProcessed(receipt2)

  await home.checkTransfer(relayTxHash2, bridgedToken, ZERO_ADDRESS, users[0], home.reduceByForeignFee(value))

  console.log('\nSending 0.1 bridged tokens to the Home Mediator')
  const balanceBefore = await foreign.web3.eth.getBalance(users[0])
  const data = WETHRouter.options.address + users[0].slice(2)
  const receipt3 = await bridgedToken.methods.transferAndCall(home.mediator.options.address, value, data).send()
  const relayTxHash3 = await foreign.waitUntilProcessed(receipt3)

  await foreign.checkTransfer(relayTxHash3, WETH, foreign.mediator, WETHRouter, home.reduceByHomeFee(value))

  const expectedBalance = toBN(balanceBefore)
    .add(toBN(home.reduceByHomeFee(value)))
    .toString()
  assert.strictEqual(await foreign.web3.eth.getBalance(users[0]), expectedBalance, 'Did not receive eth')
}

module.exports = {
  name: 'Bridging of native Foreign ETH in both directions',
  shouldRun: () => true,
  run,
}
