const TokenFactory = artifacts.require('TokenFactory')
const TokenReceiver = artifacts.require('TokenReceiver')
const OmnibridgeTokenImage = artifacts.require('OmnibridgeTokenImage')

const { generateAddress, bufferToHex, fromRpcSig } = require('ethereumjs-util')
const { expect } = require('chai')
const { ether } = require('../helpers/helpers')
const { toBN, BN } = require('../setup')

const ZERO = toBN(0)
const halfEther = ether('0.5')
const oneEther = ether('1')
const twoEthers = ether('2')

async function ethSignTypedData(from, data) {
  const result = await new Promise((res, rej) =>
    web3.currentProvider.send(
      { jsonrpc: '2.0', method: 'eth_signTypedData', params: [from, data], id: 1 },
      (err, sig) => (err ? rej(err) : res(sig))
    )
  )
  const sig = fromRpcSig(result.result)
  return [sig.v, sig.r, sig.s]
}

async function evmIncreaseTime(delta) {
  return new Promise((res, rej) =>
    web3.currentProvider.send({ jsonrpc: '2.0', method: 'evm_increaseTime', params: [delta], id: 1 }, (err, sig) =>
      err ? rej(err) : res(sig)
    )
  )
}

contract('OmnibridgeTokenImage', (accounts) => {
  let tokenImage
  let tokenFactory
  let token
  let tokenFactoryNonce = 1

  const owner = accounts[0]
  const user = accounts[1]

  before(async () => {
    tokenImage = await OmnibridgeTokenImage.new()
    tokenFactory = await TokenFactory.new(owner, tokenImage.address)
  })

  beforeEach(async () => {
    await tokenFactory.deploy('TEST', 'TST', 18)
    const tokenAddr = bufferToHex(generateAddress(tokenFactory.address, tokenFactoryNonce++))
    token = await OmnibridgeTokenImage.at(tokenAddr)
  })

  describe('ERC20', () => {
    it('public getters', async () => {
      expect(await token.name()).to.be.equal('TEST')
      expect(await token.symbol()).to.be.equal('TST')
      expect(await token.decimals()).to.be.bignumber.equal('18')
      expect(await token.totalSupply()).to.be.bignumber.equal('0')
      expect(await token.balanceOf(owner)).to.be.bignumber.equal('0')
      expect(await token.allowance(owner, user)).to.be.bignumber.equal('0')
    })

    it('transfer/approve/transferFrom', async () => {
      await token.mint(owner, twoEthers).should.be.fulfilled

      expect(await token.totalSupply()).to.be.bignumber.equal(twoEthers)
      expect(await token.balanceOf(owner)).to.be.bignumber.equal(twoEthers)
      expect(await token.balanceOf(user)).to.be.bignumber.equal(ZERO)
      expect(await token.allowance(owner, user)).to.be.bignumber.equal(ZERO)

      await token.transfer(user, oneEther).should.be.fulfilled

      expect(await token.totalSupply()).to.be.bignumber.equal(twoEthers)
      expect(await token.balanceOf(owner)).to.be.bignumber.equal(oneEther)
      expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
      expect(await token.allowance(owner, user)).to.be.bignumber.equal(ZERO)

      await token.approve(user, oneEther).should.be.fulfilled

      expect(await token.totalSupply()).to.be.bignumber.equal(twoEthers)
      expect(await token.balanceOf(owner)).to.be.bignumber.equal(oneEther)
      expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
      expect(await token.allowance(owner, user)).to.be.bignumber.equal(oneEther)

      await token.transferFrom(owner, user, oneEther, { from: user }).should.be.fulfilled

      expect(await token.totalSupply()).to.be.bignumber.equal(twoEthers)
      expect(await token.balanceOf(owner)).to.be.bignumber.equal(ZERO)
      expect(await token.balanceOf(user)).to.be.bignumber.equal(twoEthers)
      expect(await token.allowance(owner, user)).to.be.bignumber.equal(ZERO)
    })
  })

  describe('OwnableToken', () => {
    it('should return and update owner', async () => {
      expect(await token.owner()).to.be.equal(owner)

      await token.transferOwnership(user, { from: user }).should.be.rejected
      await token.transferOwnership(user, { from: owner }).should.be.fulfilled

      expect(await token.owner()).to.be.equal(user)
    })
  })

  describe('BridgedToken', () => {
    it('public getters', async () => {
      expect(await token.owner()).to.be.equal(owner)
      expect(await token.bridgeContract()).to.be.equal(owner)
      expect(await token.isBridge(owner)).to.be.equal(true)
      expect(await token.isBridge(user)).to.be.equal(false)
      const { major, minor, patch } = await token.getTokenInterfacesVersion()
      major.should.be.bignumber.gte(ZERO)
      minor.should.be.bignumber.gte(ZERO)
      patch.should.be.bignumber.gte(ZERO)
    })

    it('setBridgeContract', async () => {
      expect(await token.bridgeContract()).to.be.equal(owner)
      await token.setBridgeContract(tokenFactory.address, { from: user }).should.be.rejected
      await token.setBridgeContract(tokenFactory.address, { from: owner }).should.be.fulfilled
      expect(await token.bridgeContract()).to.be.equal(tokenFactory.address)
    })

    it('mint/burn', async () => {
      await token.mint(user, oneEther, { from: user }).should.be.rejected
      await token.mint(user, oneEther, { from: owner }).should.be.fulfilled
      expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
      expect(await token.totalSupply()).to.be.bignumber.equal(oneEther)
      await token.burn(halfEther, { from: user }).should.be.fulfilled
      expect(await token.balanceOf(user)).to.be.bignumber.equal(halfEther)
      expect(await token.totalSupply()).to.be.bignumber.equal(halfEther)
    })

    it('claimTokens', async () => {
      await token.mint(token.address, oneEther).should.be.fulfilled
      expect(await token.balanceOf(token.address)).to.be.bignumber.equal(oneEther)
      expect(await token.balanceOf(user)).to.be.bignumber.equal(ZERO)
      expect(await token.totalSupply()).to.be.bignumber.equal(oneEther)
      await token.claimTokens(token.address, user, { from: user }).should.be.rejected
      await token.claimTokens(token.address, user, { from: owner }).should.be.fulfilled
      expect(await token.balanceOf(token.address)).to.be.bignumber.equal(ZERO)
      expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
      expect(await token.totalSupply()).to.be.bignumber.equal(oneEther)
    })
  })

  describe('ERC677', () => {
    let tokenReceiver

    beforeEach(async () => {
      tokenReceiver = await TokenReceiver.new()
      await token.mint(owner, ether('10')).should.be.fulfilled
    })

    describe('transferAndCall', () => {
      it('to regular EOA', async () => {
        await token.transferAndCall(user, oneEther, '0x').should.be.fulfilled
        await token.transferAndCall(user, oneEther, '0x1122').should.be.fulfilled

        expect(await token.balanceOf(user)).to.be.bignumber.equal(twoEthers)
        expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('8'))
        expect(await token.totalSupply()).to.be.bignumber.equal(ether('10'))
      })

      it('to contract', async () => {
        await token.transferAndCall(tokenReceiver.address, oneEther, '0x1122').should.be.fulfilled

        expect(await tokenReceiver.token()).to.be.equal(token.address)
        expect(await tokenReceiver.from()).to.be.equal(owner)
        expect(await tokenReceiver.value()).to.be.bignumber.equal(oneEther)
        expect(await tokenReceiver.data()).to.be.equal('0x1122')
        expect(await token.balanceOf(tokenReceiver.address)).to.be.bignumber.equal(oneEther)
        expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('9'))
        expect(await token.totalSupply()).to.be.bignumber.equal(ether('10'))
      })
    })
  })

  describe('PermittableToken', () => {
    const EIP712Domain = [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ]
    let domain
    let permit
    let permitLegacy

    const makeLegacyMsg = (nonce, expiry, allowed) => ({
      types: {
        EIP712Domain,
        Permit: [
          { name: 'holder', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
          { name: 'allowed', type: 'bool' },
        ],
      },
      primaryType: 'Permit',
      domain,
      message: {
        holder: owner,
        spender: user,
        nonce,
        expiry,
        allowed,
      },
    })
    const makeMsg = (nonce, deadline, value) => ({
      types: {
        EIP712Domain,
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      domain,
      message: {
        owner,
        spender: user,
        value: value || oneEther.toString(),
        nonce,
        deadline,
      },
    })

    beforeEach(() => {
      domain = {
        name: 'TEST',
        version: '1',
        chainId: 1337,
        verifyingContract: token.address,
      }
      permit = token.methods['permit(address,address,uint256,uint256,uint8,bytes32,bytes32)']
      permitLegacy = token.methods['permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)']
    })

    it('public getters', async () => {
      expect(await token.version()).to.be.equal('1')
      expect(await token.nonces(owner)).to.be.bignumber.equal(ZERO)
      expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      expect((await token.DOMAIN_SEPARATOR()).length).to.be.equal(66)
      const permitType = 'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'
      expect(await token.PERMIT_TYPEHASH()).to.be.equal(web3.utils.soliditySha3(permitType))
      const permitLegacyType = 'Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)'
      expect(await token.PERMIT_TYPEHASH_LEGACY()).to.be.equal(web3.utils.soliditySha3(permitLegacyType))
    })

    describe('legacy permit', () => {
      const INFINITY = new BN('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 16)

      it('should accept signed message', async () => {
        const expiry = 10000000000
        const sig1 = await ethSignTypedData(owner, makeLegacyMsg(0, 100, true))
        const sig2 = await ethSignTypedData(owner, makeLegacyMsg(1, expiry, true))
        const sig3 = await ethSignTypedData(owner, makeLegacyMsg(0, expiry, true))

        await permitLegacy(owner, user, 0, 100, true, ...sig1).should.be.rejected // too small deadline
        await permitLegacy(owner, user, 0, expiry, true, ...sig2).should.be.rejected // invalid nonce
        await permitLegacy(owner, user, 1, expiry, true, ...sig2).should.be.rejected // not current nonce
        await permitLegacy(owner, user, 0, expiry, true, ...sig3).should.be.fulfilled // valid for nonce == 0
        await permitLegacy(owner, user, 0, expiry, true, ...sig3).should.be.rejected // invalid duplicate, invalid nonce
        await permitLegacy(owner, user, 1, expiry, true, ...sig3).should.be.rejected // invalid nonce
        await permitLegacy(user, user, 1, expiry, true, ...sig2).should.be.rejected // invalid sender
        await permitLegacy(owner, owner, 1, expiry, true, ...sig2).should.be.rejected // invalid receiver
        await permitLegacy(owner, user, 1, expiry + 1, true, ...sig2).should.be.rejected // invalid expiry
        await permitLegacy(owner, user, 1, expiry, false, ...sig2).should.be.rejected // invalid allowed
        await permitLegacy(owner, user, 1, expiry, true, ...sig2).should.be.fulfilled // valid for nonce == 1
        await permitLegacy(owner, user, 1, expiry, true, ...sig2).should.be.rejected // invalid duplicate, invalid nonce

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.nonces(owner)).to.be.bignumber.equal('2')
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))
      })

      it('should cancel expirations on infinite approval from approve()', async () => {
        const expiry = 10000000000
        const sig = await ethSignTypedData(owner, makeLegacyMsg(0, expiry, true))
        await permitLegacy(owner, user, 0, expiry, true, ...sig).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await token.approve(user, 1).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal('1')
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await token.approve(user, INFINITY).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      })

      it('should cancel expirations on infinite approval from increaseAllowance()', async () => {
        const expiry = 10000000000
        const sig = await ethSignTypedData(owner, makeLegacyMsg(0, expiry, true))
        await permitLegacy(owner, user, 0, expiry, true, ...sig).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await token.approve(user, 1).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal('1')
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await token.increaseAllowance(user, 1).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal('2')
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await token.increaseAllowance(user, INFINITY.subn(2)).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      })

      it('should cancel expirations on infinite approval from permit()', async () => {
        const expiry = 10000000000
        const sig1 = await ethSignTypedData(owner, makeLegacyMsg(0, expiry, true))
        const sig2 = await ethSignTypedData(owner, makeMsg(1, expiry))
        const sig3 = await ethSignTypedData(owner, makeMsg(2, expiry, INFINITY.toString()))
        await permitLegacy(owner, user, 0, expiry, true, ...sig1).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await permit(owner, user, oneEther, expiry, ...sig2).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(oneEther)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await permit(owner, user, INFINITY, expiry, ...sig3).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      })

      it('should cancel approval when allowed is false', async () => {
        const expiry = 10000000000
        const sig1 = await ethSignTypedData(owner, makeLegacyMsg(0, expiry, true))
        const sig2 = await ethSignTypedData(owner, makeLegacyMsg(1, expiry, false))
        await permitLegacy(owner, user, 0, expiry, true, ...sig1).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(toBN(expiry))

        await permitLegacy(owner, user, 1, expiry, false, ...sig2).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(ZERO)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      })

      it('should accept infinite approval without deadline', async () => {
        const sig1 = await ethSignTypedData(owner, makeLegacyMsg(0, 0, true))
        const sig2 = await ethSignTypedData(owner, makeLegacyMsg(1, 0, false))
        await permitLegacy(owner, user, 0, 0, true, ...sig1).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)

        await permitLegacy(owner, user, 1, 0, false, ...sig2).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(ZERO)
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      })

      it('should allow to use allowance without deadline', async () => {
        await token.mint(owner, ether('10')).should.be.fulfilled
        const sig = await ethSignTypedData(owner, makeLegacyMsg(0, 0, true))
        await permitLegacy(owner, user, 0, 0, true, ...sig).should.be.fulfilled

        await token.transferFrom(owner, user, oneEther, { from: user }).should.be.fulfilled
        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
        expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('9'))
      })

      it('should not allow to use approval after deadline', async () => {
        await token.mint(owner, ether('10')).should.be.fulfilled
        const expiry = 10000000000
        const sig = await ethSignTypedData(owner, makeLegacyMsg(0, expiry, true))
        await permitLegacy(owner, user, 0, expiry, true, ...sig).should.be.fulfilled

        await token.transferFrom(owner, user, oneEther, { from: user }).should.be.fulfilled

        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
        expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('9'))

        await evmIncreaseTime(expiry)

        await token.transferFrom(owner, user, oneEther, { from: user }).should.be.rejected
        expect(await token.allowance(owner, user)).to.be.bignumber.equal(INFINITY)
        expect(await token.balanceOf(user)).to.be.bignumber.equal(oneEther)
        expect(await token.balanceOf(owner)).to.be.bignumber.equal(ether('9'))
      })
    })

    describe('ERC2612', () => {
      it('should accept signed message', async () => {
        const deadline = 100000000000
        const sig1 = await ethSignTypedData(owner, makeMsg(0, 100))
        const sig2 = await ethSignTypedData(owner, makeMsg(1, deadline))
        const sig3 = await ethSignTypedData(owner, makeMsg(0, deadline))

        await permit(owner, user, oneEther, 100, ...sig1).should.be.rejected // too small deadline
        await permit(owner, user, oneEther, deadline, ...sig2).should.be.rejected // invalid nonce
        await permit(owner, user, oneEther, deadline, ...sig3).should.be.fulfilled // valid for nonce == 0
        await permit(owner, user, oneEther, deadline, ...sig3).should.be.rejected // invalid duplicate, invalid nonce
        await permit(user, user, oneEther, deadline, ...sig2).should.be.rejected // invalid sender
        await permit(owner, owner, oneEther, deadline, ...sig2).should.be.rejected // invalid receiver
        await permit(owner, user, twoEthers, deadline, ...sig2).should.be.rejected // invalud value
        await permit(owner, user, oneEther, deadline + 1, ...sig2).should.be.rejected // invalid deadline
        await permit(owner, user, oneEther, deadline, ...sig2).should.be.fulfilled // valid for nonce == 1
        await permit(owner, user, oneEther, deadline, ...sig2).should.be.rejected // invalid duplicate, invalid nonce
        expect(await token.allowance(owner, user)).to.be.bignumber.equal(oneEther)
        expect(await token.nonces(owner)).to.be.bignumber.equal('2')
        expect(await token.expirations(owner, user)).to.be.bignumber.equal(ZERO)
      })
    })
  })
})
