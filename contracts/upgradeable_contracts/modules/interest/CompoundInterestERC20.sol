pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../../interfaces/ICToken.sol";
import "../../../interfaces/IComptroller.sol";
import "../../../interfaces/IOwnable.sol";
import "../../../interfaces/IInterestReceiver.sol";
import "../MediatorOwnableModule.sol";

/**
 * @title CompoundInterestERC20
 * @dev This contract contains token-specific logic for investing ERC20 tokens into Compound protocol.
 */
contract CompoundInterestERC20 is MediatorOwnableModule {
    using SafeMath for uint256;

    event PaidInterest(address indexed token, address to, uint256 value);

    uint256 internal constant SUCCESS = 0;

    ICToken public immutable cToken;
    IERC20 public immutable token;
    uint256 internal immutable dust;

    uint256 public investedAmount;
    address public interestReceiver;
    uint256 public minInterestPaid;
    uint256 public minCompPaid;

    constructor(
        address _omnibridge,
        address _owner,
        ICToken _cToken,
        uint256 _dust,
        address _interestReceiver,
        uint256 _minInterestPaid,
        uint256 _minCompPaid
    ) MediatorOwnableModule(_omnibridge, _owner) {
        cToken = _cToken;
        dust = _dust;
        interestReceiver = _interestReceiver;
        minInterestPaid = _minInterestPaid;
        minCompPaid = _minCompPaid;

        IERC20 _token = _cToken.underlying();
        token = _token;
        _token.approve(address(_cToken), uint256(-1));
    }

    /**
     * @dev Tells the address of the COMP token in the Ethereum Mainnet.
     */
    function compToken() public pure virtual returns (IERC20) {
        return IERC20(0xc00e94Cb662C3520282E6f5717214004A7f26888);
    }

    /**
     * @dev Tells the address of the Comptroller contract in the Ethereum Mainnet.
     */
    function comptroller() public pure virtual returns (IComptroller) {
        return IComptroller(0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B);
    }

    /**
     * @dev Tells the amount of underlying balance according to the current exchange rate.
     * Increases after each block, when funds are not withdrawn.
     * @return amount of underlying balance.
     */
    function underlyingBalance() public returns (uint256) {
        uint256 balance = cToken.balanceOfUnderlying(address(this));
        // small portion of tokens are reserved for possible truncation/round errors
        return balance > dust ? balance - dust : 0;
    }

    /**
     * @dev Tells if interest earning is supported for the specific token contract.
     * @param _token address of the token contract.
     * @return true, if interest earning is supported for the given token.
     */
    function isInterestSupported(address _token) external view returns (bool) {
        return address(token) == _token;
    }

    /**
     * @dev Invests the given amount of tokens to the Compound protocol.
     * Only Omnibridge contract is allowed to call this method.
     * Converts _amount of TOKENs into X cTOKENs.
     * @param _amount amount of tokens to invest.
     */
    function invest(uint256 _amount) external onlyMediator {
        investedAmount = investedAmount.add(_amount);
        require(cToken.mint(_amount) == SUCCESS);
    }

    /**
     * @dev Withdraws at least the given amount of tokens from the Compound protocol.
     * Only Omnibridge contract is allowed to call this method.
     * Converts X cTOKENs into _amount of TOKENs.
     * @param _amount minimal amount of tokens to withdraw.
     */
    function withdraw(uint256 _amount) external onlyMediator {
        uint256 invested = investedAmount;
        uint256 redeemed = _safeWithdraw(_amount > invested ? invested : _amount);
        investedAmount = redeemed > invested ? 0 : invested - redeemed;
        token.transfer(mediator, redeemed);
    }

    /**
     * @dev Tells the current accumulated interest on the invested tokens, that can be withdrawn.
     * @return amount of accumulated interest.
     */
    function interestAmount() public returns (uint256) {
        uint256 balance = underlyingBalance();
        return balance > investedAmount ? balance - investedAmount : 0;
    }

    /**
     * @dev Pays collected interest for the underlying token.
     * Anyone can call this function.
     * Earned interest is withdrawn and transferred to the specified interest receiver account.
     */
    function payInterest() external {
        uint256 interest = interestAmount();
        require(interest >= minInterestPaid);
        _transferInterest(address(token), _safeWithdraw(interest));
    }

    /**
     * @dev Tells the amount of earned COMP tokens for supplying assets into the protocol that can be withdrawn.
     * @return amount of accumulated COMP tokens.
     */
    function compAmount() public returns (uint256) {
        return comptroller().compAccrued(address(this));
    }

    /**
     * @dev Claims Comp token received by supplying underlying tokens and transfers it to the associated interest receiver.
     * Claim earned comp
     */
    function claimCompAndPay() external {
        address[] memory holders = new address[](1);
        holders[0] = address(this);
        address[] memory markets = new address[](1);
        markets[0] = address(cToken);
        comptroller().claimComp(holders, markets, false, true);

        uint256 balance = compToken().balanceOf(address(this));
        require(balance >= minCompPaid);
        _transferInterest(address(compToken()), balance);
    }

    /**
     * @dev Last-resort function for returning assets to the Omnibridge contract in case of some failures in the logic.
     * Disables this contract and transfers all locked tokens back to the mediator.
     * Only owner is allowed to call this method.
     */
    function forceDisable() external onlyOwner {
        investedAmount = 0;
        token.transfer(mediator, token.balanceOf(address(this)));
        cToken.transfer(mediator, cToken.balanceOf(address(this)));
        compToken().transfer(mediator, compToken().balanceOf(address(this)));
    }

    /**
     * @dev Updates address of the interest receiver. Can be any address, EOA or contract.
     * Set to 0x00..00 to disable interest transfers.
     * Only owner is allowed to call this method.
     * @param _receiver address of the interest receiver.
     */
    function setInterestReceiver(address _receiver) external onlyOwner {
        interestReceiver = _receiver;
    }

    /**
     * @dev Updates min interest amount that can be transferred in single call.
     * Only owner is allowed to call this method.
     * @param _minInterestPaid new amount of TOKENS and can be transferred to the interest receiver in single operation.
     */
    function setMinInterestPaid(uint256 _minInterestPaid) external onlyOwner {
        minInterestPaid = _minInterestPaid;
    }

    /**
     * @dev Updates min COMP amount that can be transferred in single call.
     * Only owner is allowed to call this method.
     * @param _minCompPaid new amount of COMP and can be transferred to the interest receiver in single operation.
     */
    function setMinCompPaid(uint256 _minCompPaid) external onlyOwner {
        minCompPaid = _minCompPaid;
    }

    /**
     * @dev Internal function for securely withdrawing assets from the underlying protocol.
     * @param _amount minimal amount of underlying tokens to withdraw from Compound.
     * @return amount of redeemed tokens, at least as much as was requested.
     */
    function _safeWithdraw(uint256 _amount) private returns (uint256) {
        uint256 balance = token.balanceOf(address(this));

        require(cToken.redeemUnderlying(_amount) == SUCCESS);

        uint256 redeemed = token.balanceOf(address(this)) - balance;

        require(redeemed >= _amount);

        return redeemed;
    }

    /**
     * @dev Internal function transferring interest tokens to the interest receiver.
     * Calls a callback on the receiver, interest receiver is a contract.
     * @param _token address of the token contract to send.
     * @param _amount amount of tokens to transfer.
     */
    function _transferInterest(address _token, uint256 _amount) internal {
        address receiver = interestReceiver;
        require(receiver != address(0));

        IERC20(_token).transfer(receiver, _amount);

        if (Address.isContract(receiver)) {
            IInterestReceiver(receiver).onInterestReceived(_token);
        }

        emit PaidInterest(_token, receiver, _amount);
    }
}
