pragma solidity 0.7.5;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../Ownable.sol";
import "../../../interfaces/IInterestReceiver.sol";
import "../../../interfaces/IInterestImplementation.sol";

/**
 * @title InterestConnector
 * @dev This contract gives an abstract way of receiving interest on locked tokens.
 */
contract InterestConnector is Ownable {
    using SafeMath for uint256;

    event PaidInterest(address indexed token, address to, uint256 value);

    /**
     * @dev Tells address of the interest earning implementation for the specific token contract.
     * If interest earning is disabled, will return 0x00..00.
     * Can be an address of the deployed CompoundInterestImplementation contract.
     * @param _token address of the locked token contract.
     * @return address of the implementation contract.
     */
    function interestImplementation(address _token) public view returns (address) {
        return addressStorage[keccak256(abi.encodePacked("interestImpl", _token))];
    }

    /**
     * @dev Initializes interest receiving functionality for the particular locked token.
     * Only owner can call this method.
     * @param _token address of the token for interest earning.
     * @param _impl address of the interest earning implementation contract.
     * @param _minCashThreshold minimum amount of underlying tokens that are not invested.
     * @param _minInterestPaid minimum amount of interest that can be paid in a single call.
     * @param _interestReceiver address of the interest receiver for the particular token.
     */
    function initializeInterest(
        address _token,
        address _impl,
        uint256 _minCashThreshold,
        uint256 _minInterestPaid,
        address _interestReceiver
    ) external onlyOwner {
        _setInterestImplementation(_token, _impl);
        _setMinCashThreshold(_token, _minCashThreshold);
        _setMinInterestPaid(_token, _minInterestPaid);
        _setInterestReceiver(_token, _interestReceiver);
    }

    /**
     * @dev Sets minimum amount of tokens that cannot be invested.
     * Only owner can call this method.
     * @param _token address of the token contract.
     * @param _minCashThreshold minimum amount of underlying tokens that are not invested.
     */
    function setMinCashThreshold(address _token, uint256 _minCashThreshold) external onlyOwner {
        _setMinCashThreshold(_token, _minCashThreshold);
    }

    /**
     * @dev Tells minimum amount of tokens that are not being invested.
     * @param _token address of the invested token contract.
     * @return amount of tokens.
     */
    function minCashThreshold(address _token) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("minCashThreshold", _token))];
    }

    /**
     * @dev Sets lower limit for the paid interest amount.
     * Only owner can call this method.
     * @param _token address of the token contract.
     * @param _minInterestPaid minimum amount of interest paid in a single call.
     */
    function setMinInterestPaid(address _token, uint256 _minInterestPaid) external onlyOwner {
        _setMinInterestPaid(_token, _minInterestPaid);
    }

    /**
     * @dev Tells minimum amount of paid interest in a single call.
     * @param _token address of the invested token contract.
     * @return paid interest minimum limit.
     */
    function minInterestPaid(address _token) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("minInterestPaid", _token))];
    }

    /**
     * @dev Disables interest for locked funds.
     * Only owner can call this method.
     * Prior to calling this function, consider to call payInterest and claimCompAndPay.
     * @param _token of token to disable interest for.
     */
    function disableInterest(address _token) external onlyOwner {
        _withdraw(_token, uint256(-1));
        _setInterestImplementation(_token, address(0));
    }

    /**
     * @dev Tells configured address of the interest receiver.
     * @param _token address of the invested token contract.
     * @return address of the interest receiver.
     */
    function interestReceiver(address _token) public view returns (address) {
        return addressStorage[keccak256(abi.encodePacked("interestReceiver", _token))];
    }

    /**
     * Updates the interest receiver address.
     * Only owner can call this method.
     * @param _token address of the invested token contract.
     * @param _receiver new receiver address.
     */
    function setInterestReceiver(address _token, address _receiver) external onlyOwner {
        _setInterestReceiver(_token, _receiver);
    }

    /**
     * @dev Pays collected interest for the specific underlying token.
     * Requires interest for the given token to be enabled first.
     * @param _token address of the token contract.
     */
    function payInterest(address _token) external {
        uint256 interest = interestAmount(_token);
        require(interest >= minInterestPaid(_token));

        uint256 redeemed = _safeWithdraw(_token, interest);
        _transferInterest(_token, redeemed);
    }

    /**
     * @dev Tells the amount of underlying tokens that are currently invested.
     * @param _token address of the token contract.
     * @return amount of underlying tokens.
     */
    function investedAmount(address _token) public view returns (uint256) {
        return uintStorage[keccak256(abi.encodePacked("investedAmount", _token))];
    }

    /**
     * @dev Tells the current amount of earned interest that can be paid.
     * @param _token address of the token contract.
     * @return amount of earned interest in underlying tokens.
     */
    function interestAmount(address _token) public returns (uint256) {
        bytes memory data =
            _delegateToImpl(_token, abi.encodeWithSelector(IInterestImplementation.underlyingBalance.selector));
        uint256 underlyingBalance = abi.decode(data, (uint256));
        uint256 invested = investedAmount(_token);
        return underlyingBalance > invested ? underlyingBalance - invested : 0;
    }

    /**
     * @dev Invests all excess tokens. Leaves only minCashThreshold in underlying tokens.
     * Requires interest for the given token to be enabled first.
     * @param _token address of the token contract considered.
     */
    function invest(address _token) external {
        uint256 balance = _selfBalance(_token);
        uint256 minCash = minCashThreshold(_token);

        require(balance > minCash);
        uint256 amount = balance - minCash;

        _setInvestedAmount(_token, investedAmount(_token).add(amount));

        _delegateToImpl(_token, abi.encodeWithSelector(IInterestImplementation.invest.selector, amount));
    }

    /**
     * @dev Internal function for transferring interest.
     * Calls a callback on the receiver, if it is a contract.
     * @param _token address of the underlying token contract.
     * @param _amount amount of collected tokens that should be sent.
     */
    function _transferInterest(address _token, uint256 _amount) internal {
        address receiver = interestReceiver(_token);
        require(receiver != address(0));

        IERC20(_token).transfer(receiver, _amount);

        if (Address.isContract(receiver)) {
            IInterestReceiver(receiver).onInterestReceived(_token);
        }

        emit PaidInterest(_token, receiver, _amount);
    }

    /**
     * @dev Internal function for setting interest earning implementation contract for some token.
     * Also acts as an interest enabled flag.
     * @param _token address of the token contract.
     * @param _impl address of the implementation contract.
     */
    function _setInterestImplementation(address _token, address _impl) internal {
        require(_impl == address(0) || IInterestImplementation(_impl).isInterestSupported(_token));
        addressStorage[keccak256(abi.encodePacked("interestImpl", _token))] = _impl;
    }

    /**
     * @dev Internal function for setting the amount of underlying tokens that are currently invested.
     * @param _token address of the token contract.
     * @param _amount new amount of invested tokens.
     */
    function _setInvestedAmount(address _token, uint256 _amount) internal {
        uintStorage[keccak256(abi.encodePacked("investedAmount", _token))] = _amount;
    }

    /**
     * @dev Internal function for withdrawing some amount of the invested tokens.
     * Reverts if given amount cannot be withdrawn.
     * @param _token address of the token contract withdrawn.
     * @param _amount amount of requested tokens to be withdrawn.
     */
    function _withdraw(address _token, uint256 _amount) internal {
        uint256 invested = investedAmount(_token);
        uint256 withdrawal = _amount > invested ? invested : _amount;
        uint256 redeemed = _safeWithdraw(_token, withdrawal);

        _setInvestedAmount(_token, invested > redeemed ? invested - redeemed : 0);
    }

    /**
     * @dev Internal function for safe withdrawal of invested tokens.
     * Reverts if given amount cannot be withdrawn.
     * Additionally verifies that at least _amount of tokens were withdrawn.
     * @param _token address of the token contract withdrawn.
     * @param _amount amount of requested tokens to be withdrawn.
     */
    function _safeWithdraw(address _token, uint256 _amount) private returns (uint256) {
        uint256 balance = _selfBalance(_token);

        _delegateToImpl(_token, abi.encodeWithSelector(IInterestImplementation.withdraw.selector, _amount));

        uint256 redeemed = _selfBalance(_token) - balance;

        require(redeemed >= _amount);

        return redeemed;
    }

    /**
     * @dev Internal function for setting minimum amount of tokens that cannot be invested.
     * @param _token address of the token contract.
     * @param _minCashThreshold minimum amount of underlying tokens that are not invested.
     */
    function _setMinCashThreshold(address _token, uint256 _minCashThreshold) internal {
        uintStorage[keccak256(abi.encodePacked("minCashThreshold", _token))] = _minCashThreshold;
    }

    /**
     * @dev Internal function for setting lower limit for paid interest amount.
     * @param _token address of the token contract.
     * @param _minInterestPaid minimum amount of interest paid in a single call.
     */
    function _setMinInterestPaid(address _token, uint256 _minInterestPaid) internal {
        uintStorage[keccak256(abi.encodePacked("minInterestPaid", _token))] = _minInterestPaid;
    }

    /**
     * @dev Internal function for setting interest receiver address.
     * @param _token address of the invested token contract.
     * @param _receiver address of the interest receiver.
     */
    function _setInterestReceiver(address _token, address _receiver) internal {
        require(_receiver != address(this));
        addressStorage[keccak256(abi.encodePacked("interestReceiver", _token))] = _receiver;
    }

    /**
     * @dev Tells this contract balance of some specific token contract
     * @param _token address of the token contract.
     * @return contract balance.
     */
    function _selfBalance(address _token) internal view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }

    /**
     * @dev Internal function for delegating some implementation-specific logic to the associated implementation contract.
     * @param _token address of the token contract.
     * @param _data calldata to use in the delegatecall.
     * @return returned data from the call.
     */
    function _delegateToImpl(address _token, bytes memory _data) internal returns (bytes memory) {
        address impl = interestImplementation(_token);
        require(impl != address(0));
        (bool status, bytes memory returnData) = impl.delegatecall(_data);
        require(status);
        return returnData;
    }
}
