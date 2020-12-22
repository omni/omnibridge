pragma solidity 0.7.5;

import "./BasicNFTOmnibridge.sol";

/**
 * @title HomeNFTOmnibridge
 * @dev Home side implementation for multi-token ERC721 mediator intended to work on top of AMB bridge.
 * It is designed to be used as an implementation contract of EternalStorageProxy contract.
 */
contract HomeNFTOmnibridge is BasicNFTOmnibridge {
    /**
     * @dev Internal function for transforming the bridged token name. Appends a side-specific suffix.
     * @param _name bridged token from the other side.
     * @return token name for this side of the bridge.
     */
    function _transformName(string memory _name) internal pure override returns (string memory) {
        return string(abi.encodePacked(_name, " on xDai"));
    }
}
