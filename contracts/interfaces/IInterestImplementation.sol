pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IInterestImplementation {
    function isInterestSupported(address _token) external view returns (bool);

    function invest(address _token, uint256 _amount) external;

    function withdraw(address _token, uint256 _amount) external;

    function investedAmount(address _token) external view returns (uint256);
}
