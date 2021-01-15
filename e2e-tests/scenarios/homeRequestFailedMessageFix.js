const assert = require('assert')
const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ home, foreign, users, owner, findMessageId }) {
  const value = toWei('10')
  const homeBridgedToken = await home.getBridgedToken(foreign.token)

  async function waitUntilFailedThenFix(receipt) {
    const status = await home.waitUntilProcessed(receipt)
    assert.ok(!status, 'Message should have been failed')
    const messageId = findMessageId(receipt)

    console.log(`Requesting failed message fix for message id ${messageId}`)
    const receipt2 = await home.mediator.methods.requestFailedMessageFix(messageId).send({ from: owner })
    return foreign.waitUntilProcessed(receipt2)
  }

  await home.withDisabledExecution(homeBridgedToken, async () => {
    console.log('Sending 10 tokens to the Foreign Mediator')
    const receipt = await foreign.token.methods.transferAndCall(foreign.mediator.options.address, value, '0x').send()
    const relayTxHash = await waitUntilFailedThenFix(receipt)

    // fee was NOT subtracted when the failed message was processed on the home side, since it reverted
    await foreign.checkTransfer(relayTxHash, foreign.token, foreign.mediator, users[0], value)
  })

  console.log('Sending 10 tokens to the Home Mediator')
  const receipt2 = await home.token.methods.transferAndCall(home.mediator.options.address, value, '0x').send()
  await foreign.waitUntilProcessed(receipt2)
  const foreignBridgedToken = await foreign.getBridgedToken(home.token)

  await home.withDisabledExecution(home.token, async () => {
    const value = toWei('5')
    console.log('Sending 5 tokens to the Foreign Mediator')
    const receipt = await foreignBridgedToken.methods
      .transferAndCall(foreign.mediator.options.address, value, '0x')
      .send()
    const relayTxHash = await waitUntilFailedThenFix(receipt)

    // fee was NOT subtracted when the failed message was processed on the home side, since it reverted
    await foreign.checkTransfer(relayTxHash, foreignBridgedToken, ZERO_ADDRESS, users[0], value)
  })
}

module.exports = {
  name: 'Fixing failed bridge operations on the home side',
  shouldRun: async ({ home, foreign, owner }) => {
    const token = await home.mediator.methods.bridgedTokenAddress(foreign.token.options.address).call()
    return owner && token !== ZERO_ADDRESS
  },
  run,
}
