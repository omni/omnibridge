pragma solidity 0.7.5;

import "../../BasicAMBMediator.sol";

/**
 * @title SelectorGasLimitManager
 * @dev Functionality for determining the request gas limit for AMB execution based on the request selectors.
 */
abstract contract SelectorGasLimitManager is BasicAMBMediator {
    bytes32 internal constant REQUEST_GAS_LIMIT = 0x2dfd6c9f781bb6bbb5369c114e949b69ebb440ef3d4dd6b2836225eb1dc3a2be; // keccak256(abi.encodePacked("requestGasLimit"))

    /**
     * @dev Sets the default gas limit to be used in the message execution by the AMB bridge on the other network.
     * This value can't exceed the parameter maxGasPerTx defined on the AMB bridge.
     * Only the owner can call this method.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function setRequestGasLimit(uint256 _gasLimit) external onlyOwner {
        _setRequestGasLimit(0x00000000, _gasLimit);
    }

    /**
     * @dev Sets the selector-specific gas limit to be used in the message execution by the AMB bridge on the other network.
     * This value can't exceed the parameter maxGasPerTx defined on the AMB bridge.
     * Only the owner can call this method.
     * @param _selector method selector of the outgoing message payload.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function setRequestGasLimit(bytes4 _selector, uint256 _gasLimit) external onlyOwner {
        _setRequestGasLimit(_selector, _gasLimit);
    }

    /**
     * @dev Tells the default gas limit to be used in the message execution by the AMB bridge on the other network.
     * @return the gas limit for the message execution.
     */
    function requestGasLimit() public view returns (uint256) {
        return requestGasLimit(0x00000000);
    }

    /**
     * @dev Tells the selector-specific gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector for the passed message, use 0x00000000 for setting the default gas limit.
     * @return the gas limit for the message execution.
     */
    function requestGasLimit(bytes4 _selector) public view returns (uint256) {
        return uintStorage[REQUEST_GAS_LIMIT ^ _selector];
    }

    /**
     * @dev Tells the gas limit to use for the message execution by the AMB bridge on the other network.
     * @param _data calldata to be used on the other side of the bridge, when execution a message.
     * @return the gas limit fot the message execution.
     */
    function _chooseRequestGasLimit(bytes memory _data) internal view override returns (uint256) {
        bytes4 selector;
        assembly {
            // first 4 bytes of _data contain the selector of the function to be called on the other side of the bridge.
            // mload(add(_data, 4)) loads selector to the 28-31 bytes of the word.
            // shl(28 * 8, x) then used to correct the padding of the selector, putting it to 0-3 bytes of the word.
            selector := shl(224, mload(add(_data, 4)))
        }
        uint256 gasLimit = requestGasLimit(selector);
        return gasLimit == 0 ? requestGasLimit() : gasLimit;
    }

    /**
     * @dev Stores the gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector of the outgoing message payload, use 0x00000000 for setting the default gas limit.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function _setRequestGasLimit(bytes4 _selector, uint256 _gasLimit) internal {
        require(_gasLimit <= maxGasPerTx());
        // xor-based hashing here is used for determining the mapping key, such approach allows to save small amount of gas
        // and allows seamless migration between the gas limit managers,
        // since both GasLimitManager.setRequestGasLimit(uint256) and SelectorGasLimitManager.setRequestGasLimit(uint256) use the same mapping slot.
        // It is safe-enough to use xor-based hashing here, since the mapping key cannot be altered at 4..31 bytes.
        // (_selector can have non-zero bytes only at 0..3 positions).
        uintStorage[REQUEST_GAS_LIMIT ^ _selector] = _gasLimit;
    }
}
