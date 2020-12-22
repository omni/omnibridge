pragma solidity 0.7.5;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/IOwnable.sol";
import "../interfaces/IBurnableMintableERC721Token.sol";

/**
 * @title ERC721BridgeToken
 * @dev template token contract for bridged ERC721 tokens.
 */
contract ERC721BridgeToken is ERC721, IBurnableMintableERC721Token {
    address public bridgeContract;

    constructor(
        string memory _name,
        string memory _symbol,
        address _bridgeContract
    ) ERC721(_name, _symbol) {
        bridgeContract = _bridgeContract;
    }

    /**
     * @dev Throws if sender is not a bridge contract.
     */
    modifier onlyBridge() {
        require(msg.sender == bridgeContract);
        _;
    }

    /**
     * @dev Throws if sender is not a bridge contract or bridge contract owner.
     */
    modifier onlyOwner() {
        require(msg.sender == bridgeContract || msg.sender == IOwnable(bridgeContract).owner());
        _;
    }

    /**
     * @dev Mint new ERC721 token.
     * Only bridge contract is authorized to mint tokens.
     * @param _to address of the newly created token owner.
     * @param _tokenId unique identifier of the minted token.
     */
    function mint(address _to, uint256 _tokenId) external override onlyBridge {
        _safeMint(_to, _tokenId);
    }

    /**
     * @dev Burns some ERC721 token.
     * Only bridge contract is authorized to burn tokens.
     * @param _tokenId unique identifier of the burned token.
     */
    function burn(uint256 _tokenId) external override onlyBridge {
        _burn(_tokenId);
    }

    /**
     * @dev Sets the base URI for all tokens.
     * Can be called by bridge owner after token contract was instantiated.
     * @param _baseURI new base URI.
     */
    function setBaseURI(string calldata _baseURI) external onlyOwner {
        _setBaseURI(_baseURI);
    }

    /**
     * @dev Updates the bridge contract address.
     * Can be called by bridge owner after token contract was instantiated.
     * @param _bridgeContract address of the new bridge contract.
     */
    function setBridgeContract(address _bridgeContract) external onlyOwner {
        require(_bridgeContract != address(0));
        bridgeContract = _bridgeContract;
    }
}
