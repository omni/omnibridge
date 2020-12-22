pragma solidity 0.7.5;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Metadata.sol";
import "../../../Ownable.sol";

/**
 * @title ERC721Reader
 * @dev Functionality for reading metadata from the ERC721 tokens.
 */
contract ERC721Reader is Ownable {
    /**
     * @dev Sets the custom metadata for the given ERC721 token.
     * Only owner can call this method.
     * Useful when original NFT token does not implement neither name() nor symbol() methods.
     * @param _token address of the token contract.
     * @param _name custom name for the token contract.
     * @param _symbol custom symbol for the token contract.
     */
    function setCustomMetadata(
        address _token,
        string calldata _name,
        string calldata _symbol
    ) external onlyOwner {
        stringStorage[keccak256(abi.encodePacked("customName", _token))] = _name;
        stringStorage[keccak256(abi.encodePacked("customSymbol", _token))] = _symbol;
    }

    /**
     * @dev Internal function for reading ERC721 token name.
     * Use custom predefined name in case name() function is not implemented.
     * @param _token address of the ERC721 token contract.
     * @return custom name for the token contract.
     */
    function _readName(address _token) internal view returns (string memory) {
        (bool status, bytes memory data) = _token.staticcall(abi.encodeWithSelector(IERC721Metadata.name.selector));
        return status ? abi.decode(data, (string)) : stringStorage[keccak256(abi.encodePacked("customName", _token))];
    }

    /**
     * @dev Internal function for reading ERC721 token symbol.
     * Use custom predefined symbol in case symbol() function is not implemented.
     * @param _token address of the ERC721 token contract.
     * @return custom symbol for the token contract.
     */
    function _readSymbol(address _token) internal view returns (string memory) {
        (bool status, bytes memory data) = _token.staticcall(abi.encodeWithSelector(IERC721Metadata.symbol.selector));
        return status ? abi.decode(data, (string)) : stringStorage[keccak256(abi.encodePacked("customSymbol", _token))];
    }
}
