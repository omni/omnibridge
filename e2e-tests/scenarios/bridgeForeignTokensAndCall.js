const assert = require('assert')
const { toWei } = require('../utils')

async function run({ foreign, home }) {
  console.log('Bridging Native Foreign token to Home chain')
  const { token, mediator } = foreign
  const { tokenReceiver } = home
  const value = toWei('10')

  console.log('Sending 10 tokens to the Foreign Mediator with extra data')
  await token.methods.approve(mediator.options.address, value).send()
  const receipt1 = await mediator.methods.relayTokensAndCall(
    token.options.address,
    tokenReceiver.options.address,
    value,
    '0x1122'
  ).send()
  const relayTxHash1 = await home.waitUntilProcessed(receipt1)
  const bridgedToken = await home.getBridgedToken(token)

  await home.checkTransfer(relayTxHash1, bridgedToken, home.mediator, tokenReceiver, home.reduceByForeignFee(value))
  assert.strictEqual(await tokenReceiver.methods.data().call(), '0x1122', 'Data was not passed correctly')
}

module.exports = {
  name: 'Bridging of Foreign tokens with extra data',
  shouldRun: ({ foreign }) => {
    return foreign.mediator.methods.isTokenRegistered(foreign.token.options.address).call()
  },
  run,
}
