pragma solidity 0.7.5;

contract TokenReceiver {
    address public token;
    address public from;
    uint256 public value;
    bytes public data;

    function onTokenTransfer(
        address _from,
        uint256 _value,
        bytes memory _data
    ) external {
        token = msg.sender;
        from = _from;
        value = _value;
        data = _data;
    }
}
