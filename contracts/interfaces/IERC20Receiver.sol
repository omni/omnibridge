pragma solidity 0.7.5;

interface IERC20Receiver {
    function onTokenTransfer(
        address from,
        uint256 value,
        bytes calldata data
    ) external;
}
