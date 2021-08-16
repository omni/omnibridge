pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../../interfaces/IAToken.sol";
import "../../../interfaces/IOwnable.sol";
import "../../../interfaces/IInterestReceiver.sol";
import "../../../interfaces/IInterestImplementation.sol";
import "../../../interfaces/ILendingPool.sol";
import "../MediatorOwnableModule.sol";

/**
 * @title AAVEInterestERC20
 * @dev This contract contains token-specific logic for investing ERC20 tokens into AAVE protocol.
 */
contract AAVEInterestERC20 is IInterestImplementation, MediatorOwnableModule {
    using SafeMath for uint256;

    event PaidInterest(address indexed token, address to, uint256 value);
    event ForceDisable(address token, uint256 tokensAmount, uint256 aTokensAmount, uint256 investedAmount);

    struct InterestParams {
        IAToken aToken;
        uint96 dust;
        uint256 investedAmount;
        address interestReceiver;
        uint256 minInterestPaid;
    }

    mapping(address => InterestParams) public interestParams;

    constructor(address _omnibridge, address _owner) MediatorOwnableModule(_omnibridge, _owner) {}

    /**
     * @dev Tells the module interface version that this contract supports.
     * @return major value of the version
     * @return minor value of the version
     * @return patch value of the version
     */
    function getModuleInterfacesVersion()
        external
        pure
        returns (
            uint64 major,
            uint64 minor,
            uint64 patch
        )
    {
        return (1, 0, 0);
    }

    /**
     * @dev Tells the address of the LendingPool contract in the Ethereum Mainnet.
     */
    function lendingPool() public pure virtual returns (ILendingPool) {
        return ILendingPool(0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9);
    }

    /**
     * @dev Enables support for interest earning through a specific aToken.
     * @param _token address of the token contract for which to enable interest.
     * @param _dust small amount of underlying tokens that cannot be paid as an interest. Accounts for possible truncation errors.
     * @param _interestReceiver address of the interest receiver for underlying token.
     * @param _minInterestPaid min amount of underlying tokens to be paid as an interest.
     */
    function enableInterestToken(
        address _token,
        uint96 _dust,
        address _interestReceiver,
        uint256 _minInterestPaid
    ) external onlyOwner {
        IAToken aToken = IAToken(lendingPool().getReserveData(_token)[7]);
        require(aToken.UNDERLYING_ASSET_ADDRESS() == _token);

        // disallow reinitialization of tokens that were already initialized and invested
        require(interestParams[_token].investedAmount == 0);

        interestParams[_token] = InterestParams(aToken, _dust, 0, _interestReceiver, _minInterestPaid);

        IERC20(_token).approve(address(lendingPool()), uint256(-1));
    }

    /**
     * @dev Tells the current amount of underlying tokens that was invested into the AAVE protocol.
     * @param _token address of the underlying token.
     * @return currently invested value.
     */
    function investedAmount(address _token) external view override returns (uint256) {
        return interestParams[_token].investedAmount;
    }

    /**
     * @dev Tells if interest earning is supported for the specific underlying token contract.
     * @param _token address of the token contract.
     * @return true, if interest earning is supported for the given token.
     */
    function isInterestSupported(address _token) external view override returns (bool) {
        return address(interestParams[_token].aToken) != address(0);
    }

    /**
     * @dev Invests the given amount of tokens to the AAVE protocol.
     * Only Omnibridge contract is allowed to call this method.
     * Converts _amount of TOKENs into aTOKENs.
     * @param _token address of the invested token contract.
     * @param _amount amount of tokens to invest.
     */
    function invest(address _token, uint256 _amount) external override onlyMediator {
        InterestParams storage params = interestParams[_token];
        params.investedAmount = params.investedAmount.add(_amount);
        lendingPool().deposit(_token, _amount, address(this), 0);
    }

    /**
     * @dev Withdraws at least min(_amount, investedAmount) of tokens from the AAVE protocol.
     * Only Omnibridge contract is allowed to call this method.
     * Converts aTOKENs into _amount of TOKENs.
     * @param _token address of the invested token contract.
     * @param _amount minimal amount of tokens to withdraw.
     */
    function withdraw(address _token, uint256 _amount) external override onlyMediator {
        InterestParams storage params = interestParams[_token];
        uint256 invested = params.investedAmount;
        uint256 redeemed = _safeWithdraw(_token, _amount > invested ? invested : _amount);
        params.investedAmount = redeemed > invested ? 0 : invested - redeemed;
        IERC20(_token).transfer(mediator, redeemed);
    }

    /**
     * @dev Tells the current accumulated interest on the invested tokens, that can be withdrawn and payed to the interest receiver.
     * @param _token address of the invested token contract.
     * @return amount of accumulated interest.
     */
    function interestAmount(address _token) public view returns (uint256) {
        InterestParams storage params = interestParams[_token];
        (IAToken aToken, uint96 dust) = (params.aToken, params.dust);
        uint256 balance = aToken.balanceOf(address(this));
        // small portion of tokens are reserved for possible truncation/round errors
        uint256 reserved = params.investedAmount.add(dust);
        return balance > reserved ? balance - reserved : 0;
    }

    /**
     * @dev Pays collected interest for the underlying token.
     * Anyone can call this function.
     * Earned interest is withdrawn and transferred to the specified interest receiver account.
     * @param _token address of the invested token contract in which interest should be paid.
     */
    function payInterest(address _token) external {
        InterestParams storage params = interestParams[_token];
        uint256 interest = interestAmount(_token);
        require(interest >= params.minInterestPaid);
        _transferInterest(params.interestReceiver, address(_token), _safeWithdraw(_token, interest));
    }

    /**
     * @dev Last-resort function for returning assets to the Omnibridge contract in case of some failures in the logic.
     * Disables this contract and transfers locked tokens back to the mediator.
     * Only owner is allowed to call this method.
     * @param _token address of the invested token contract that should be disabled.
     */
    function forceDisable(address _token) external onlyOwner {
        InterestParams storage params = interestParams[_token];
        IAToken aToken = params.aToken;

        uint256 aTokenBalance = aToken.balanceOf(address(this));
        // try to redeem all aTokens
        try lendingPool().withdraw(_token, aTokenBalance, mediator) {
            aTokenBalance = 0;
        } catch {
            aToken.transfer(mediator, aTokenBalance);
        }

        uint256 balance = IERC20(_token).balanceOf(address(this));
        IERC20(_token).transfer(mediator, balance);

        emit ForceDisable(_token, balance, aTokenBalance, params.investedAmount);

        delete interestParams[_token];
    }

    /**
     * @dev Updates dust parameter for the particular token.
     * Only owner is allowed to call this method.
     * @param _token address of the invested token contract.
     * @param _dust new amount of underlying tokens that cannot be paid as an interest. Accounts for possible truncation errors.
     */
    function setDust(address _token, uint96 _dust) external onlyOwner {
        interestParams[_token].dust = _dust;
    }

    /**
     * @dev Updates address of the interest receiver. Can be any address, EOA or contract.
     * Set to 0x00..00 to disable interest transfers.
     * Only owner is allowed to call this method.
     * @param _token address of the invested token contract.
     * @param _receiver address of the interest receiver.
     */
    function setInterestReceiver(address _token, address _receiver) external onlyOwner {
        interestParams[_token].interestReceiver = _receiver;
    }

    /**
     * @dev Updates min interest amount that can be transferred in single call.
     * Only owner is allowed to call this method.
     * @param _token address of the invested token contract.
     * @param _minInterestPaid new amount of TOKENS and can be transferred to the interest receiver in single operation.
     */
    function setMinInterestPaid(address _token, uint256 _minInterestPaid) external onlyOwner {
        interestParams[_token].minInterestPaid = _minInterestPaid;
    }

    /**
     * @dev Internal function for securely withdrawing assets from the underlying protocol.
     * @param _token address of the invested token contract.
     * @param _amount minimal amount of underlying tokens to withdraw from AAVE.
     * @return amount of redeemed tokens, at least as much as was requested.
     */
    function _safeWithdraw(address _token, uint256 _amount) private returns (uint256) {
        uint256 balance = IERC20(_token).balanceOf(address(this));

        lendingPool().withdraw(_token, _amount, address(this));

        uint256 redeemed = IERC20(_token).balanceOf(address(this)) - balance;

        require(redeemed >= _amount);

        return redeemed;
    }

    /**
     * @dev Internal function transferring interest tokens to the interest receiver.
     * Calls a callback on the receiver, interest receiver is a contract.
     * @param _receiver address of the tokens receiver.
     * @param _token address of the token contract to send.
     * @param _amount amount of tokens to transfer.
     */
    function _transferInterest(
        address _receiver,
        address _token,
        uint256 _amount
    ) internal {
        require(_receiver != address(0));

        IERC20(_token).transfer(_receiver, _amount);

        if (Address.isContract(_receiver)) {
            IInterestReceiver(_receiver).onInterestReceived(_token);
        }

        emit PaidInterest(_token, _receiver, _amount);
    }
}
