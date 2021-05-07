pragma solidity 0.7.5;

import "../upgradeable_contracts/modules/interest/CompoundInterestERC20.sol";

contract CompoundInterestERC20Mock is CompoundInterestERC20 {
    constructor(
        address _omnibridge,
        address _owner,
        ICToken _cToken,
        uint256 _dust,
        address _interestReceiver,
        uint256 _minInterestPaid,
        uint256 _minCompPaid
    ) CompoundInterestERC20(_omnibridge, _owner, _cToken, _dust, _interestReceiver, _minInterestPaid, _minCompPaid) {}

    function comptroller() public pure override returns (IComptroller) {
        return IComptroller(0x85e855b22F01BdD33eE194490c7eB16b7EdaC019);
    }

    function compToken() public pure override returns (IERC20) {
        return IERC20(0x6f51036Ec66B08cBFdb7Bd7Fb7F40b184482d724);
    }
}
