const { toWei } = require('../utils')

async function run({ foreign, users, owner }) {
  console.log('Claiming Foreign erc20 tokens')
  const { claimableToken, mediator } = foreign

  console.log('Sending 10 tokens to the Foreign Mediator')
  await claimableToken.methods.transfer(mediator.options.address, toWei('10')).send()

  console.log('Sending claim request to the Foreign Mediator')
  const receipt = await mediator.methods.claimTokens(claimableToken.options.address, users[0]).send({ from: owner })

  await foreign.checkTransfer(receipt.transactionHash, claimableToken, mediator, users[0], null)
}

module.exports = {
  name: 'Claiming of foreign tokens',
  shouldRun: async ({ foreign, owner }) => {
    if (!owner) {
      return false
    }
    const skip = await foreign.mediator.methods.isTokenRegistered(foreign.claimableToken.options.address).call()
    if (skip) {
      console.log('Specified foreign token is not claimable, it is already registered in the mediator.')
    }
    return !skip
  },
  run,
}
