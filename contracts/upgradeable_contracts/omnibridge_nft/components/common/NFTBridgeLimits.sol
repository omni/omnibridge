pragma solidity 0.7.5;

import "../../../Ownable.sol";

/**
 * @title NFTBridgeLimits
 * @dev Functionality for keeping track of bridging limits for multiple ERC721 tokens.
 */
abstract contract NFTBridgeLimits is Ownable {
    // token == 0x00..00 represents default limits for all newly created tokens
    event DailyLimitChanged(address indexed token, uint256 newLimit);
    event ExecutionDailyLimitChanged(address indexed token, uint256 newLimit);

    /**
     * @dev Checks if specified token was already bridged at least once.
     * @param _token address of the token contract.
     * @return true, if token was already bridged.
     */
    function isTokenRegistered(address _token) public view virtual returns (bool);

    /**
     * @dev Retrieves the total spent amount for particular token during specific day.
     * @param _token address of the token contract.
     * @param _day day number for which spent amount if requested.
     * @return amount of tokens sent through the bridge to the other side.
     */
    function totalSpentPerDay(address _token, uint256 _day) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("totalSpentPerDay", _token, _day))];
    }

    /**
     * @dev Retrieves the total executed amount for particular token during specific day.
     * @param _token address of the token contract.
     * @param _day day number for which spent amount if requested.
     * @return amount of tokens received from the bridge from the other side.
     */
    function totalExecutedPerDay(address _token, uint256 _day) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("totalExecutedPerDay", _token, _day))];
    }

    /**
     * @dev Retrieves current daily limit for a particular token contract.
     * @param _token address of the token contract.
     * @return daily limit on tokens that can be sent through the bridge per day.
     */
    function dailyLimit(address _token) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("dailyLimit", _token))];
    }

    /**
     * @dev Retrieves current execution daily limit for a particular token contract.
     * @param _token address of the token contract.
     * @return daily limit on tokens that can be received from the bridge on the other side per day.
     */
    function executionDailyLimit(address _token) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("executionDailyLimit", _token))];
    }

    /**
     * @dev Checks that bridged amount of tokens conforms to the configured limits.
     * @param _token address of the token contract.
     * @return true, if specified amount can be bridged.
     */
    function withinLimit(address _token) public view returns (bool) {
        return dailyLimit(address(0)) > 0 && dailyLimit(_token) > totalSpentPerDay(_token, getCurrentDay());
    }

    /**
     * @dev Checks that bridged amount of tokens conforms to the configured execution limits.
     * @param _token address of the token contract.
     * @return true, if specified amount can be processed and executed.
     */
    function withinExecutionLimit(address _token) public view returns (bool) {
        return
            executionDailyLimit(address(0)) > 0 &&
            executionDailyLimit(_token) > totalExecutedPerDay(_token, getCurrentDay());
    }

    /**
     * @dev Returns current day number.
     * @return day number.
     */
    function getCurrentDay() public view returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp / 1 days;
    }

    /**
     * @dev Updates daily limit for the particular token. Only owner can call this method.
     * @param _token address of the token contract, or address(0) for configuring the efault limit.
     * @param _dailyLimit daily allowed amount of bridged tokens, should be greater than maxPerTx.
     * 0 value is also allowed, will stop the bridge operations in outgoing direction.
     */
    function setDailyLimit(address _token, uint256 _dailyLimit) external onlyOwner {
        require(_token == address(0) || isTokenRegistered(_token));
        _setDailyLimit(_token, _dailyLimit);
    }

    /**
     * @dev Updates execution daily limit for the particular token. Only owner can call this method.
     * @param _token address of the token contract, or address(0) for configuring the default limit.
     * @param _dailyLimit daily allowed amount of executed tokens, should be greater than executionMaxPerTx.
     * 0 value is also allowed, will stop the bridge operations in incoming direction.
     */
    function setExecutionDailyLimit(address _token, uint256 _dailyLimit) external onlyOwner {
        require(_token == address(0) || isTokenRegistered(_token));
        _setExecutionDailyLimit(_token, _dailyLimit);
    }

    /**
     * @dev Internal function for adding spent amount for some token.
     * @param _token address of the token contract.
     */
    function addTotalSpentPerDay(address _token) internal {
        uintStorage[keccak256(abi.encodePacked("totalSpentPerDay", _token, getCurrentDay()))] += 1;
    }

    /**
     * @dev Internal function for adding executed amount for some token.
     * @param _token address of the token contract.
     */
    function addTotalExecutedPerDay(address _token) internal {
        uintStorage[keccak256(abi.encodePacked("totalExecutedPerDay", _token, getCurrentDay()))] += 1;
    }

    /**
     * @dev Internal function for initializing limits for some token.
     * @param _token address of the token contract.
     * @param _dailyLimit daily limit for the given token.
     */
    function _setDailyLimit(address _token, uint256 _dailyLimit) internal {
        uintStorage[keccak256(abi.encodePacked("dailyLimit", _token))] = _dailyLimit;
        emit DailyLimitChanged(_token, _dailyLimit);
    }

    /**
     * @dev Internal function for initializing execution limits for some token.
     * @param _token address of the token contract.
     * @param _dailyLimit daily execution limit for the given token.
     */
    function _setExecutionDailyLimit(address _token, uint256 _dailyLimit) internal {
        uintStorage[keccak256(abi.encodePacked("executionDailyLimit", _token))] = _dailyLimit;
        emit ExecutionDailyLimitChanged(_token, _dailyLimit);
    }
}
