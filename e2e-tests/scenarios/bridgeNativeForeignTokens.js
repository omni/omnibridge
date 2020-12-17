const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ foreign, home, users }) {
  console.log('Bridging Native Foreign token to Home chain')
  const { token, mediator } = foreign
  const value = toWei('10')

  console.log('Sending 10 tokens to the Foreign Mediator')
  const receipt1 = await token.methods.transferAndCall(mediator.options.address, value, '0x').send()
  const relayTxHash1 = await home.waitUntilProcessed(receipt1)
  const bridgedToken = await home.getBridgedToken(token)

  await home.checkTransfer(relayTxHash1, bridgedToken, ZERO_ADDRESS, users[0], home.reduceByForeignFee(value))

  console.log('\nSending 10 more tokens to the Foreign Mediator')
  const receipt2 = await token.methods.transferAndCall(mediator.options.address, value, '0x').send()
  const relayTxHash2 = await home.waitUntilProcessed(receipt2)

  await home.checkTransfer(relayTxHash2, bridgedToken, ZERO_ADDRESS, users[0], home.reduceByForeignFee(value))

  console.log('\nSending 10 bridged tokens to the Home Mediator')
  const receipt3 = await bridgedToken.methods.transferAndCall(home.mediator.options.address, value, '0x').send()
  const relayTxHash3 = await foreign.waitUntilProcessed(receipt3)

  await foreign.checkTransfer(relayTxHash3, token, mediator, users[0], home.reduceByHomeFee(value))
}

module.exports = {
  name: 'Bridging of native Foreign tokens in both directions',
  shouldRun: () => true,
  run,
}
