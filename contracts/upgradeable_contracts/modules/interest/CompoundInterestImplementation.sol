pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../interfaces/ICToken.sol";
import "../../../interfaces/IComptroller.sol";

/**
 * @title CompoundInterestImplementation
 * @dev This contract contains token-specific logic for working with particular token within the Compound protocol.
 */
contract CompoundInterestImplementation {
    uint256 internal constant SUCCESS = 0;

    ICToken public immutable cToken;
    IERC20 public immutable token;
    uint256 internal immutable dust;

    constructor(ICToken _cToken, uint256 _dust) {
        cToken = _cToken;
        token = _cToken.underlying();
        dust = _dust;
    }

    /**
     * @dev Tells the address of the Comptroller contract in the Ethereum Mainnet.
     */
    function comptroller() public pure virtual returns (IComptroller) {
        return IComptroller(0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B);
    }

    /**
     * @dev Tells the amount of underlying balance according to the current exchange rate.
     * Increases after each block.
     * @return amount of underlying balance.
     */
    function underlyingBalance() external returns (uint256) {
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
     * Converts _amount of TOKENs into X cTOKENs.
     * @param _amount amount of tokens to invest.
     */
    function invest(uint256 _amount) external {
        token.approve(address(cToken), _amount);
        require(cToken.mint(_amount) == SUCCESS);
    }

    /**
     * @dev Withdraws at least the given amount of tokens from the Compound protocol.
     * Converts X cTOKENs into _amount of TOKENs.
     * @param _amount minimal amount of tokens to withdraw.
     */
    function withdraw(uint256 _amount) external {
        require(cToken.redeemUnderlying(_amount) == SUCCESS);
    }

    /**
     * @dev Claims Comp token received by supplying underlying tokens and transfers it to the associated interest receiver.
     */
    function claimComp() external {
        address[] memory holders = new address[](1);
        holders[0] = address(this);
        address[] memory markets = new address[](1);
        markets[0] = address(cToken);
        comptroller().claimComp(holders, markets, false, true);
    }
}
