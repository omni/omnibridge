pragma solidity 0.7.5;

import "../upgradeable_contracts/modules/interest/AAVEInterestERC20.sol";

contract AAVEInterestERC20Mock is AAVEInterestERC20 {
    constructor(address _omnibridge, address _owner) AAVEInterestERC20(_omnibridge, _owner) {}

    function lendingPool() public pure override returns (ILendingPool) {
        return ILendingPool(0xDe4e2b5D55D2eE0F95b6D96C1BF86b45364e45B0);
    }
}
