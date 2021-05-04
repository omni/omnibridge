pragma solidity 0.7.5;

import "./InterestConnector.sol";

/**
 * @title CompoundInterestConnector
 * @dev This contract gives an abstract way of receiving interest on locked tokens using compound protocol.
 */
contract CompoundInterestConnector is InterestConnector {
    using SafeMath for uint256;

    /**
     * @dev Tells the address of the COMP token in the Ethereum Mainnet.
     */
    function compToken() public pure virtual returns (IERC20) {
        return IERC20(0xc00e94Cb662C3520282E6f5717214004A7f26888);
    }

    /**
     * @dev Claims Comp token and transfers it to the associated interest receiver.
     * @param _token address of the token present in Compound marker, for which the COMP should be claimed.
     */
    function claimCompAndPay(address _token) external {
        address comp = address(compToken());
        uint256 balanceBefore = _selfBalance(comp);
        _delegateToImpl(_token, abi.encodeWithSelector(IInterestImplementation.claimComp.selector));
        uint256 claimed = _selfBalance(comp).sub(balanceBefore);
        require(claimed >= minInterestPaid(comp));
        _transferInterest(comp, claimed);
    }
}
