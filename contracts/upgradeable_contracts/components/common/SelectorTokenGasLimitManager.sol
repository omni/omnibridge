pragma solidity 0.7.5;

import "../../BasicAMBMediator.sol";

/**
 * @title SelectorTokenGasLimitManager
 * @dev Basic storage and methods needed by mediators to interact with AMB bridge.
 * @dev Functionality for determining the request gas limit for AMB execution based on the request selectors and bridged tokens.
 */
abstract contract SelectorTokenGasLimitManager is BasicAMBMediator {
    bytes32 internal constant REQUEST_GAS_LIMIT = 0x2dfd6c9f781bb6bbb5369c114e949b69ebb440ef3d4dd6b2836225eb1dc3a2be; // keccak256(abi.encodePacked("requestGasLimit"))

    /**
     * @dev Sets the default gas limit to be used in the message execution by the AMB bridge on the other network.
     * This value can't exceed the parameter maxGasPerTx defined on the AMB bridge.
     * Only the owner can call this method.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function setRequestGasLimit(uint256 _gasLimit) external onlyOwner {
        _setRequestGasLimit(0x00000000, address(0), _gasLimit);
    }

    /**
     * @dev Sets the selector-specific gas limit to be used in the message execution by the AMB bridge on the other network.
     * This value can't exceed the parameter maxGasPerTx defined on the AMB bridge.
     * Only the owner can call this method.
     * @param _selector method selector of the outgoing message payload.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function setRequestGasLimit(bytes4 _selector, uint256 _gasLimit) external onlyOwner {
        _setRequestGasLimit(_selector, address(0), _gasLimit);
    }

    /**
     * @dev Sets the token-specific gas limit to be used in the message execution by the AMB bridge on the other network.
     * This value can't exceed the parameter maxGasPerTx defined on the AMB bridge.
     * Only the owner can call this method.
     * @param _selector method selector of the outgoing message payload.
     * @param _token address of the native token that is used in the first argument of handleBridgedTokens/handleNativeTokens.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function setRequestGasLimit(
        bytes4 _selector,
        address _token,
        uint256 _gasLimit
    ) external onlyOwner {
        _setRequestGasLimit(_selector, _token, _gasLimit);
    }

    /**
     * @dev Tells the default gas limit to be used in the message execution by the AMB bridge on the other network.
     * @return the gas limit for the message execution.
     */
    function requestGasLimit() public view returns (uint256) {
        return requestGasLimit(0x00000000, address(0));
    }

    /**
     * @dev Tells the selector-specific gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector for the passed message, use 0x00000000 for setting the default gas limit.
     * @return the gas limit for the message execution.
     */
    function requestGasLimit(bytes4 _selector) public view returns (uint256) {
        return requestGasLimit(_selector, address(0));
    }

    /**
     * @dev Tells the token-specific gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector for the passed message, use 0x00000000 for setting the default gas limit.
     * @param _token address of the native token that is used in the first argument of handleBridgedTokens/handleNativeTokens.
     * @return the gas limit for the message execution.
     */
    function requestGasLimit(bytes4 _selector, address _token) public view returns (uint256) {
        return uintStorage[REQUEST_GAS_LIMIT ^ _selector ^ bytes32(uint256(_token))];
    }

    /**
     * @dev Tells the gas limit to use for the message execution by the AMB bridge on the other network.
     * @param _data calldata to be used on the other side of the bridge, when execution a message.
     * @return the gas limit fot the message execution.
     */
    function _chooseRequestGasLimit(bytes memory _data) internal view override returns (uint256) {
        bytes4 selector;
        address token;
        assembly {
            selector := shl(224, mload(add(_data, 4)))
            token := mload(add(_data, 36))
        }
        uint256 gasLimit = requestGasLimit(selector, token);
        if (gasLimit == 0) {
            gasLimit = requestGasLimit(selector);
            if (gasLimit == 0) {
                gasLimit = requestGasLimit();
            }
        }
        return gasLimit;
    }

    /**
     * @dev Stores the gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector of the outgoing message payload, use 0x00000000 for setting the default gas limit.
     * @param _token address of the native token that is used in the first argument of handleBridgedTokens/handleNativeTokens.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function _setRequestGasLimit(
        bytes4 _selector,
        address _token,
        uint256 _gasLimit
    ) internal {
        require(_gasLimit <= maxGasPerTx());
        uintStorage[REQUEST_GAS_LIMIT ^ _selector ^ bytes32(uint256(_token))] = _gasLimit;
    }
}
