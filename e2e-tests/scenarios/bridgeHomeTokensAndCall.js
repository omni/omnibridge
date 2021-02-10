const assert = require('assert')
const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ foreign, home }) {
  console.log('Bridging Native Home token to Foreign chain')
  const { token, mediator } = home
  const { tokenReceiver } = foreign
  const value = toWei('10')

  console.log('Sending 10 tokens to the Home Mediator with extra data')
  const receipt1 = await token.methods
    .transferAndCall(mediator.options.address, value, `${tokenReceiver.options.address}1122`)
    .send()
  const relayTxHash1 = await foreign.waitUntilProcessed(receipt1)
  const bridgedToken = await foreign.getBridgedToken(token)

  await foreign.checkTransfer(relayTxHash1, bridgedToken, ZERO_ADDRESS, tokenReceiver, home.reduceByHomeFee(value))
  assert.strictEqual(await tokenReceiver.methods.data().call(), '0x1122', 'Data was not passed correctly')

  console.log('Sending 5 tokens to the Foreign Mediator with extra data')
  const receipt2 = await bridgedToken.methods
    .transferAndCall(foreign.mediator.options.address, toWei('5'), `${home.tokenReceiver.options.address}3344`)
    .send()
  const relayTxHash2 = await home.waitUntilProcessed(receipt2)

  await home.checkTransfer(relayTxHash2, token, mediator, home.tokenReceiver, home.reduceByForeignFee(toWei('5')))
  assert.strictEqual(await home.tokenReceiver.methods.data().call(), '0x3344', 'Data was not passed correctly')
}

module.exports = {
  name: 'Bridging of Home tokens with extra data',
  shouldRun: () => true,
  run,
}
