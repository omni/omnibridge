pragma solidity 0.7.5;

import "../interfaces/IERC20Receiver.sol";
import "../interfaces/IERC677Receiver.sol";

contract TokenReceiver is IERC20Receiver, IERC677Receiver {
    address public token;
    address public from;
    uint256 public value;
    bytes public data;

    function onTokenBridged(
        address _token,
        uint256 _value,
        bytes memory _data
    ) external override {
        token = _token;
        from = msg.sender;
        value = _value;
        data = _data;
    }

    function onTokenTransfer(
        address _from,
        uint256 _value,
        bytes memory _data
    ) external override {
        token = msg.sender;
        from = _from;
        value = _value;
        data = _data;
    }
}
