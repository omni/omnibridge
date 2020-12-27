pragma solidity 0.7.5;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../../upgradeability/EternalStorage.sol";

/**
 * @title DecimalShiftHandler
 * @dev Functionality storing and calculating required decimals shifts for bridged token values.
 */
contract DecimalShiftHandler is EternalStorage {
    using SafeMath for uint256;

    /**
     * @dev Internal function for setting decimal shift multiplier for the bridged token.
     * @param _token address of the bridged token contract.
     * @param _shift decimals difference (bridged token decimals - native token decimals).
     */
    function _setDecimalShift(address _token, int256 _shift) internal {
        int256 multiplier = 0;
        if (_shift > 0) {
            multiplier = int256(10**uint256(_shift));
        } else if (_shift < 0) {
            multiplier = -int256(10**uint256(-_shift));
        }
        intStorage[keccak256(abi.encodePacked("decimalShift", _token))] = multiplier;
    }

    /**
     * @dev Converts the amount of home tokens into the equivalent amount of foreign tokens.
     * @param _token address of the bridged token contract.
     * @param _value amount of home tokens.
     * @return equivalent amount of foreign tokens.
     */
    function _unshiftValue(address _token, uint256 _value) internal view returns (uint256) {
        return _shiftUint(_value, -_shiftMultiplier(_token));
    }

    /**
     * @dev Converts the amount of foreign tokens into the equivalent amount of home tokens.
     * @param _token address of the bridged token contract.
     * @param _value amount of foreign tokens.
     * @return equivalent amount of home tokens.
     */
    function _shiftValue(address _token, uint256 _value) internal view returns (uint256) {
        return _shiftUint(_value, _shiftMultiplier(_token));
    }

    /**
     * @dev Internal function getting decimals shift multiplier.
     * If = 0, nothing should be shifted, decimals are equal.
     * If > 0, bridged token decimals is greater than the native token decimals.
     * If < 0, bridged token decimals is lesser than the native token decimals.
     * @param _token address of the bridged token contract.
     * @return multiplier for value conversion.
     */
    function _shiftMultiplier(address _token) private view returns (int256) {
        return intStorage[keccak256(abi.encodePacked("decimalShift", _token))];
    }

    /**
     * @dev Calculates shifted value.
     * @param _value amount of tokens.
     * @param _shift decimal shift multiplier to apply (10**shift).
     * @return shifted value.
     */
    function _shiftUint(uint256 _value, int256 _shift) private pure returns (uint256) {
        if (_shift == 0) {
            return _value;
        }
        return _shift > 0 ? _value.mul(uint256(_shift)) : _value.div(uint256(-_shift));
    }
}
