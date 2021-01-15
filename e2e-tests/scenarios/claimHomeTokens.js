const { toWei } = require('../utils')

async function run({ home, users, owner }) {
  console.log('Claiming Home erc20 tokens')
  const { claimableToken, mediator } = home

  console.log('Sending 10 tokens to the Home Mediator')
  await claimableToken.methods.transfer(mediator.options.address, toWei('10')).send()

  console.log('Sending claim request to the Home Mediator')
  const receipt = await mediator.methods.claimTokens(claimableToken.options.address, users[0]).send({ from: owner })

  await home.checkTransfer(receipt.transactionHash, claimableToken, mediator, users[0], null)
}

module.exports = {
  name: 'Claiming of home tokens',
  shouldRun: async ({ home, owner }) => {
    if (!owner) {
      return false
    }
    const skip = await home.mediator.methods.isTokenRegistered(home.claimableToken.options.address).call()
    if (skip) {
      console.log('Specified home token is not claimable, it is already registered in the mediator.')
    }
    return !skip
  },
  run,
}
