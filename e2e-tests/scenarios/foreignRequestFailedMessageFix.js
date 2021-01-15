const assert = require('assert')
const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ home, foreign, users, owner, findMessageId }) {
  const value = toWei('10')
  const foreignBridgedToken = await foreign.getBridgedToken(home.token)

  async function waitUntilFailedThenFix(receipt) {
    const status = await foreign.waitUntilProcessed(receipt)
    assert.ok(!status, 'Message should have been failed')
    const messageId = findMessageId(receipt)

    console.log(`Requesting failed message fix for message id ${messageId}`)
    const receipt2 = await foreign.mediator.methods.requestFailedMessageFix(messageId).send({ from: owner })
    return home.waitUntilProcessed(receipt2)
  }

  await foreign.withDisabledExecution(foreignBridgedToken, async () => {
    console.log('Sending 10 tokens to the Home Mediator')
    const receipt = await home.token.methods.transferAndCall(home.mediator.options.address, value, '0x').send()
    const relayTxHash = await waitUntilFailedThenFix(receipt)

    // fee was subtracted when the failed message was initiated
    await home.checkTransfer(relayTxHash, home.token, home.mediator, users[0], home.reduceByHomeFee(value))
  })

  console.log('Sending 10 tokens to the Foreign Mediator')
  const receipt = await foreign.token.methods.transferAndCall(foreign.mediator.options.address, value, '0x').send()
  await home.waitUntilProcessed(receipt)
  const homeBridgedToken = await home.getBridgedToken(foreign.token)

  await foreign.withDisabledExecution(foreign.token, async () => {
    const value = toWei('5')
    console.log('Sending 5 tokens to the Home Mediator')
    const receipt = await homeBridgedToken.methods.transferAndCall(home.mediator.options.address, value, '0x').send()
    const relayTxHash = await waitUntilFailedThenFix(receipt)

    // fee was subtracted when the failed message was initiated
    await home.checkTransfer(relayTxHash, homeBridgedToken, ZERO_ADDRESS, users[0], home.reduceByHomeFee(value))
  })
}

module.exports = {
  name: 'Fixing failed bridge operations on the foreign side',
  shouldRun: async ({ home, foreign, owner }) => {
    const token = await foreign.mediator.methods.bridgedTokenAddress(home.token.options.address).call()
    return owner && token !== ZERO_ADDRESS
  },
  run,
}
