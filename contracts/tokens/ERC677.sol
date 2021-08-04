pragma solidity 0.7.5;

import "./openzeppelin/ERC20.sol";
import "../interfaces/IERC677Receiver.sol";
import "../interfaces/IERC677.sol";

/**
 * @title ERC677
 * @dev The basic implementation of an ERC677 token.
 */
contract ERC677 is ERC20, IERC677 {
    /**
     * @dev Throws if recipient address is not valid.
     */
    modifier validRecipient(address _recipient) {
        require(_recipient != address(0) && _recipient != address(this));
        /* solcov ignore next */
        _;
    }

    /**
     * @dev Executes a ERC20 transfer(_to, _value).
     * Executes a onTokenTransfer callback on the receiver address.
     * Emits an additional Transfer event with extra data field.
     * @param _to token receiver address.
     * @param _value amount of tokens to transfer.
     * @param _data extra data to pass in the callback of the receiver.
     */
    function transferAndCall(
        address _to,
        uint256 _value,
        bytes memory _data
    ) external override validRecipient(_to) returns (bool) {
        _transfer(_msgSender(), _to, _value);

        emit Transfer(_msgSender(), _to, _value, _data);

        if (Address.isContract(_to)) {
            _contractFallback(_msgSender(), _to, _value, _data);
        }
        return true;
    }

    /**
     * @dev Calls onTokenTransfer fallback on the token recipient contract.
     * @param _from tokens sender.
     * @param _to tokens recipient.
     * @param _value amount of tokens that was sent.
     * @param _data set of extra bytes that can be passed to the recipient.
     */
    function _contractFallback(
        address _from,
        address _to,
        uint256 _value,
        bytes memory _data
    ) internal {
        IERC677Receiver(_to).onTokenTransfer(_from, _value, _data);
    }
}
