pragma solidity 0.7.5;

import "../upgradeable_contracts/modules/interest/CompoundInterestImplementation.sol";

contract CompoundInterestImplementationMock is CompoundInterestImplementation {
    constructor(ICToken _cToken, uint256 _dust) CompoundInterestImplementation(_cToken, _dust) {}

    function comptroller() public pure override returns (IComptroller) {
        return IComptroller(0x85e855b22F01BdD33eE194490c7eB16b7EdaC019);
    }
}
