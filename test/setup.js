const { BN, toBN } = web3.utils

require('chai').use(require('chai-as-promised')).use(require('chai-bn')(BN))

require('chai/register-should')

const truffleContract = require('@truffle/contract')

exports.BN = BN
exports.toBN = toBN
exports.ERROR_MSG = 'VM Exception while processing transaction: revert'
exports.ERROR_MSG_OPCODE = 'VM Exception while processing transaction: invalid opcode'
exports.ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
exports.F_ADDRESS = '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF'
exports.INVALID_ARGUMENTS = 'Invalid number of arguments to Solidity function'
exports.requirePrecompiled = async (path) => {
  const artifact = require(`../precompiled/${path}`)
  const contract = truffleContract(artifact)
  contract.setProvider(web3.currentProvider)
  const accounts = await web3.eth.getAccounts()
  contract.defaults({ from: accounts[0] })
  contract.disableConfirmationListener = true
  return contract
}
