pragma solidity 0.7.5;

import "../upgradeable_contracts/ForeignOmnibridge.sol";

contract ForeignOmnibridgeMock is ForeignOmnibridge {
    constructor(string memory _suffix) ForeignOmnibridge(_suffix) {}

    function compToken() public pure override returns (IERC20) {
        return IERC20(0x6f51036Ec66B08cBFdb7Bd7Fb7F40b184482d724);
    }
}
