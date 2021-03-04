pragma solidity 0.7.5;

/**
 * @title TokenStorageLayout
 * @dev Storage layout for tokens contract used together with Omnibridge
 */
contract TokenStorageLayout {
    string internal _name;
    string internal _symbol;
    uint8 internal _decimals;
    mapping(address => uint256) internal _balances;
    uint256 internal _totalSupply;
    mapping(address => mapping(address => uint256)) internal _allowances;
    address internal _owner;

    bool internal _mintingFinished; // unused

    address internal bridgeContractAddr;
    // string public constant version = "1";
    bytes32 internal _DOMAIN_SEPARATOR;
    // bytes32 public constant PERMIT_TYPEHASH = 0xea2aa0a1be11a07ed86d755c93467f4f82362b452371d1ba94d1715123511acb;
    mapping(address => uint256) internal _nonces;
    mapping(address => mapping(address => uint256)) internal _expirations;
}
