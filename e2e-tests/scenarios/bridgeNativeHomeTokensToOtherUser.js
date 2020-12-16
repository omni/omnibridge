const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ foreign, home, users }) {
  console.log('Bridging Native Home token to Foreign chain with alternative receiver')
  const { token, mediator } = home
  const value = toWei('10')

  console.log('Sending 10 tokens to the Home Mediator')
  const receipt1 = await token.methods.transferAndCall(mediator.options.address, value, users[1]).send()
  const relayTxHash1 = await foreign.waitUntilProcessed(receipt1)
  const bridgedToken = await foreign.getBridgedToken(token)

  await foreign.checkTransfer(relayTxHash1, bridgedToken, ZERO_ADDRESS, users[1], home.reduceByHomeFee(value))

  console.log('\nSending 10 more tokens to the Home Mediator')
  const receipt2 = await token.methods.transferAndCall(mediator.options.address, value, users[1]).send()
  const relayTxHash2 = await foreign.waitUntilProcessed(receipt2)

  await foreign.checkTransfer(relayTxHash2, bridgedToken, ZERO_ADDRESS, users[1], home.reduceByHomeFee(value))

  console.log('\nSending 10 bridged tokens to the Foreign Mediator')
  const receipt3 = await bridgedToken.methods
    .transferAndCall(foreign.mediator.options.address, value, users[0])
    .send({ from: users[1] })
  const relayTxHash3 = await home.waitUntilProcessed(receipt3)

  await home.checkTransfer(relayTxHash3, token, mediator, users[0], home.reduceByForeignFee(value))
}

module.exports = {
  name: 'Bridging of native Home tokens in both directions with alternative receiver',
  shouldRun: (env) => env.users.length > 1,
  run,
}
