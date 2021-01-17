const Web3 = require('web3')

const { toWei, toBN } = Web3.utils

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const toAddress = (contract) => (typeof contract === 'string' ? contract : contract.options.address)

function addPendingTxLogger(provider) {
  const send = provider.send.bind(provider)
  // eslint-disable-next-line no-param-reassign
  provider.send = function (payload, callback) {
    send(payload, (err, result) => {
      if (payload.method === 'eth_sendRawTransaction') {
        console.log(`pending tx: ${result.result}`)
      }
      callback(err, result)
    })
  }
  return provider
}

module.exports = {
  toWei,
  toBN,
  ZERO_ADDRESS,
  toAddress,
  addPendingTxLogger,
}
