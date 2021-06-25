const IERC20 = artifacts.require('IERC20')
const IMintableERC20 = artifacts.require('IMintableERC20')
const ILendingPool = artifacts.require('ILendingPool')

async function getAAVEContracts() {
  const dai = await IMintableERC20.at('0xe78A0F7E598Cc8b0Bb87894B0F60dD2a88d6a8Ab')
  const usdc = await IMintableERC20.at('0xD833215cBcc3f914bD1C9ece3EE7BF8B14f841bb')
  const aDai = await IERC20.at('0xb62439d2627C23Dccf22931688A879B6E12A5a2f')
  const lendingPool = await ILendingPool.at('0xDe4e2b5D55D2eE0F95b6D96C1BF86b45364e45B0')
  return { dai, usdc, aDai, lendingPool }
}

module.exports = getAAVEContracts
