pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IInterestImplementation {
    function isInterestSupported(address _token) external pure returns (bool);

    function invest(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    function investedAmount() external view returns (uint256);

    function claimComp() external;
}
