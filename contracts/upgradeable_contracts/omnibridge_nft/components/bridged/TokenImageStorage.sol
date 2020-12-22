pragma solidity 0.7.5;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../../Ownable.sol";

/**
 * @title TokenImageStorage
 * @dev Storage functionality for working with ERC721 image contract.
 */
contract TokenImageStorage is Ownable {
    bytes32 internal constant TOKEN_IMAGE_CONTRACT = 0x20b8ca26cc94f39fab299954184cf3a9bd04f69543e4f454fab299f015b8130f; // keccak256(abi.encodePacked("tokenImageContract"))

    /**
     * @dev Updates address of the used ERC721 token image.
     * Only owner can call this method.
     * @param _image address of the new token image.
     */
    function setTokenImage(address _image) external onlyOwner {
        _setTokenImage(_image);
    }

    /**
     * @dev Tells the address of the used ERC721 token image.
     * @return address of the used token image.
     */
    function tokenImage() public view returns (address) {
        return addressStorage[TOKEN_IMAGE_CONTRACT];
    }

    /**
     * @dev Internal function for updating address of the used ERC721 token image.
     * @param _image address of the new token image.
     */
    function _setTokenImage(address _image) internal {
        require(Address.isContract(_image));
        addressStorage[TOKEN_IMAGE_CONTRACT] = _image;
    }
}
