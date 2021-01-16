const assert = require('assert')
const { toWei } = require('../utils')

async function run({ foreign, home }) {
  console.log('Bridging Native Home token to Foreign chain')
  const { token, mediator } = home
  const { tokenReceiver } = foreign
  const value = toWei('10')

  console.log('Sending 10 tokens to the Home Mediator with extra data')
  await token.methods.approve(mediator.options.address, value).send()
  const receipt1 = await mediator.methods.relayTokensAndCall(
    token.options.address,
    tokenReceiver.options.address,
    value,
    '0x1122'
  ).send()
  const relayTxHash1 = await foreign.waitUntilProcessed(receipt1)
  const bridgedToken = await foreign.getBridgedToken(token)

  await foreign.checkTransfer(relayTxHash1, bridgedToken, foreign.mediator, tokenReceiver, home.reduceByHomeFee(value))
  assert.strictEqual(await tokenReceiver.methods.data().call(), '0x1122', 'Data was not passed correctly')
}

module.exports = {
  name: 'Bridging of Home tokens with extra data',
  shouldRun: ({ home }) => {
    return home.mediator.methods.isTokenRegistered(home.token.options.address).call()
  },
  run,
}
