pragma solidity 0.7.5;

import "../interfaces/IBurnableMintableERC677Token.sol";
import "../interfaces/IERC677Receiver.sol";
import "./ERC677.sol";
import "./BridgedToken.sol";
import "./PermittableToken.sol";

/**
 * @title OmnibridgeTokenImage
 * @dev The basic implementation of a bridgeable ERC677-compatible token
 */
contract OmnibridgeTokenImage is ERC677, BridgedToken, PermittableToken {
    function approve(address _to, uint256 _value) public override(ERC20, PermittableToken) returns (bool) {
        return PermittableToken.approve(_to, _value);
    }

    function increaseAllowance(address _to, uint256 _addedValue)
        public
        override(ERC20, PermittableToken)
        returns (bool)
    {
        return PermittableToken.increaseAllowance(_to, _addedValue);
    }

    function transfer(address _to, uint256 _value) public virtual override returns (bool result) {
        result = super.transfer(_to, _value);

        if (isBridge(_to)) {
            _contractFallback(_msgSender(), _to, _value, new bytes(0));
        }
    }

    function transferFrom(
        address _from,
        address _to,
        uint256 _value
    ) public virtual override(ERC20, PermittableToken) returns (bool result) {
        result = PermittableToken.transferFrom(_from, _to, _value);

        if (isBridge(_to)) {
            _contractFallback(_from, _to, _value, new bytes(0));
        }
    }
}
