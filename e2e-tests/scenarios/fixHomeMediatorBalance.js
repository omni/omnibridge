const assert = require('assert')
const { toWei, toBN, ZERO_ADDRESS } = require('../utils')

async function run({ home, foreign, users, owner }) {
  console.log('Fixing mediator balance of the home mediator')
  const { mediator, token } = home

  console.log('Sending 10 tokens to the Home Mediator')
  await token.methods.transfer(mediator.options.address, toWei('10')).send()

  const initialMediatorBalance = await mediator.methods.mediatorBalance(token.options.address).call()
  const initialTokenBalance = await token.methods.balanceOf(mediator.options.address).call()
  const diff = toBN(initialTokenBalance).sub(toBN(initialMediatorBalance)).toString(10)
  console.log(`Balance diff ${diff}`)

  console.log('Sending fixMediatorBalance request to the Foreign Mediator')
  const receipt = await mediator.methods.fixMediatorBalance(token.options.address, users[0]).send({ from: owner })
  const relayTxHash = await foreign.waitUntilProcessed(receipt)
  const bridgedToken = await foreign.getBridgedToken(token)

  const mediatorBalance = await mediator.methods.mediatorBalance(token.options.address).call()
  const tokenBalance = await token.methods.balanceOf(mediator.options.address).call()
  assert.strictEqual(mediatorBalance, tokenBalance, 'Balance was not fixed')

  // fee is NOT taken for Home->Foreign transfer on the home side when fixing a message
  await foreign.checkTransfer(relayTxHash, bridgedToken, ZERO_ADDRESS, users[0], diff)
}

module.exports = {
  name: 'Fixing mediator balance of the home mediator',
  shouldRun: async ({ home, owner }) => {
    const isRegistered = await home.mediator.methods.isTokenRegistered(home.token.options.address).call()
    return owner && isRegistered
  },
  run,
}
