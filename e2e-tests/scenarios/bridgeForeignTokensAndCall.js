const assert = require('assert')
const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ foreign, home }) {
  console.log('Bridging Native Foreign token to Home chain')
  const { token, mediator } = foreign
  const { tokenReceiver } = home
  const value = toWei('10')

  console.log('Sending 10 tokens to the Foreign Mediator with extra data')
  const receipt1 = await token.methods
    .transferAndCall(mediator.options.address, value, `${tokenReceiver.options.address}1122`)
    .send()
  const relayTxHash1 = await home.waitUntilProcessed(receipt1)
  const bridgedToken = await home.getBridgedToken(token)

  await home.checkTransfer(relayTxHash1, bridgedToken, ZERO_ADDRESS, tokenReceiver, home.reduceByForeignFee(value))
  assert.strictEqual(await tokenReceiver.methods.data().call(), '0x1122', 'Data was not passed correctly')

  console.log('Sending 5 tokens to the Home Mediator with extra data')
  const receipt2 = await bridgedToken.methods
    .transferAndCall(home.mediator.options.address, toWei('5'), `${foreign.tokenReceiver.options.address}3344`)
    .send()
  const relayTxHash2 = await foreign.waitUntilProcessed(receipt2)

  await foreign.checkTransfer(relayTxHash2, token, mediator, foreign.tokenReceiver, home.reduceByHomeFee(toWei('5')))
  assert.strictEqual(await foreign.tokenReceiver.methods.data().call(), '0x3344', 'Data was not passed correctly')
}

module.exports = {
  name: 'Bridging of Foreign tokens with extra data',
  shouldRun: () => true,
  run,
}
