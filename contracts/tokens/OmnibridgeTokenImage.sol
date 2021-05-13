pragma solidity 0.7.5;

import "../interfaces/IBurnableMintableERC677Token.sol";
import "../interfaces/IERC677Receiver.sol";
import "./ERC677.sol";
import "./BridgedToken.sol";
import "./PermittableToken.sol";

/**
 * @title OmnibridgeTokenImage
 * @dev The primary token image used together with TokenProxy for all bridge tokens.
 */
contract OmnibridgeTokenImage is ERC677, BridgedToken, PermittableToken {
    /**
     * @dev Approves the given address to spend tokens on behalf of the sender.
     * Resets expiration timestamp in case of unlimited approval.
     * @param _to address allowed to spend tokens.
     * @param _value amount of given allowance.
     * @return true, if operation succeeded.
     */
    function approve(address _to, uint256 _value) public override(ERC20, PermittableToken) returns (bool) {
        return PermittableToken.approve(_to, _value);
    }

    /**
     * @dev Atomically increases the allowance granted to spender by the caller.
     * Resets expiration timestamp in case of unlimited approval.
     * @param _to address allowed to spend tokens.
     * @param _addedValue amount of allowance increase.
     * @return true, if operation succeeded.
     */
    function increaseAllowance(address _to, uint256 _addedValue)
        public
        override(ERC20, PermittableToken)
        returns (bool)
    {
        return PermittableToken.increaseAllowance(_to, _addedValue);
    }

    /**
     * @dev Transfers tokens on to a different address.
     * If tokens are transferred to the bridge contract by that method,
     * ERC677 callback will be executed on the bridge contract in the same transaction.
     * @param _to tokens receiver address.
     * @param _value amount of transferred tokens.
     * @return result true, if operation succeeded.
     */
    function transfer(address _to, uint256 _value) public virtual override returns (bool result) {
        result = super.transfer(_to, _value);

        if (isBridge(_to)) {
            _contractFallback(_msgSender(), _to, _value, new bytes(0));
        }
    }

    /**
     * @dev Uses previously given allowance to transfer tokens on behalf of a different user.
     * Works in a slightly different form than the generic transferFrom.
     * In case of an existing unlimited approval from the sender, allowance value is not being decreased.
     * If tokens are transferred to the bridge contract by that method,
     * ERC677 callback will be executed on the bridge contract in the same transaction.
     * @param _from address from where to spend tokens.
     * @param _to tokens receiver address.
     * @param _value amount of transferred tokens.
     * @return result true, if operation succeeded.
     */
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
