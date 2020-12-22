pragma solidity 0.7.5;

import "../../../../upgradeability/EternalStorage.sol";

/**
 * @title NFTMediatorBalanceStorage
 * @dev Functionality for storing expected mediator balance for native tokens.
 */
contract NFTMediatorBalanceStorage is EternalStorage {
    /**
     * @dev Tells if mediator owns the given token. More strict than regular token.ownerOf() check,
     * since does not take into account forced tokens.
     * @param _token address of token contract.
     * @param _tokenId id of the new owned token.
     * @return true, if given token is already accounted in the mediator balance.
     */
    function mediatorOwns(address _token, uint256 _tokenId) public view returns (bool) {
        return boolStorage[keccak256(abi.encodePacked("mediatorOwns", _token, _tokenId))];
    }

    /**
     * @dev Updates ownership information for the particular token.
     * @param _token address of token contract.
     * @param _tokenId id of the new owned token.
     * @param _owns true, if new token is received. false, when token is released.
     */
    function _setMediatorOwns(
        address _token,
        uint256 _tokenId,
        bool _owns
    ) internal {
        boolStorage[keccak256(abi.encodePacked("mediatorOwns", _token, _tokenId))] = _owns;
    }
}
