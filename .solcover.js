const Web3 = require('web3')

module.exports = {
  mocha: {
    timeout: 30000
  },
  forceBackupServer: true,
  providerOptions: {
    port: 8545,
    seed: 'TestRPC is awesome!'
  },
  onServerReady: async (config) => {
    const web3 = new Web3(config.provider)
    const abi = [{
      inputs: [{ name: "", type: "address"}],
      outputs: [{ name: "", type: "uint256" }],
      name: "balanceOf",
      stateMutability: "view",
      type: "function"
    }]
    const cDai = new web3.eth.Contract(abi, '0x615cba17EE82De39162BB87dBA9BcfD6E8BcF298')
    const faucet = (await web3.eth.getAccounts())[6]
    while (true) {
      try {
        if (await cDai.methods.balanceOf(faucet).call() !== '0') {
          break
        }
      } catch (e) {
        await new Promise(res => setTimeout(res, 1000))
      }
    }
  },
  skipFiles: ['mocks']
}
