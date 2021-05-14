const { toWei, ZERO_ADDRESS } = require('../utils')

async function run({ foreign, home, users }) {
  const { mediator, compound } = foreign
  const { faucet, token, enableInterest, disableInterest, waitForInterest, acquireInterest } = compound
  const value = toWei('10')

  console.log('Sending 10 tokens to the Foreign Mediator')
  await token.methods.approve(mediator.options.address, value).send()
  const relayTokens = mediator.methods['relayTokens(address,address,uint256)']
  const receipt1 = await relayTokens(token.options.address, users[0], value).send({ from: faucet })
  const relayTxHash1 = await home.waitUntilProcessed(receipt1)
  const bridgedToken = await home.getBridgedToken(token)

  await home.checkTransfer(relayTxHash1, bridgedToken, ZERO_ADDRESS, users[0], home.reduceByForeignFee(value))

  await enableInterest()

  await waitForInterest()

  await acquireInterest()

  console.log('\nSending 5 bridged tokens to the Home Mediator')
  const receipt3 = await bridgedToken.methods.transferAndCall(home.mediator.options.address, toWei('5'), '0x').send()
  const relayTxHash3 = await foreign.waitUntilProcessed(receipt3)

  await foreign.checkTransfer(relayTxHash3, token, mediator, users[0], home.reduceByHomeFee(toWei('5')))

  await waitForInterest()

  await acquireInterest()

  await disableInterest()
}

module.exports = {
  name: 'Bridge operations when compound investing logic is enabled',
  shouldRun: ({ owner, foreign }) => !!owner && !!foreign.compound.token,
  run,
}
