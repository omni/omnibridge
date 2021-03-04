pragma solidity 0.7.5;

interface IClaimable {
    function claimTokens(address _token, address _to) external;
}
