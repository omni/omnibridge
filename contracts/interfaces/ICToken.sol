pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICToken {
    function underlying() external returns (IERC20);

    function mint(uint256 mintAmount) external returns (uint256);

    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function balanceOfUnderlying(address account) external returns (uint256);

    function borrow(uint256 borrowAmount) external returns (uint256);

    function repayBorrow(uint256 borrowAmount) external returns (uint256);
}
