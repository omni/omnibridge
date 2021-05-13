pragma solidity 0.7.5;

/**
 * @title TokenStorageLayout
 * @dev Storage layout for tokens contract used together with Omnibridge
 */
contract TokenStorageLayout {
    // NOTE: It is safe to add new storage variables only to the end of this file.

    string internal _name;
    string internal _symbol;
    uint8 internal _decimals;
    mapping(address => uint256) internal _balances;
    uint256 internal _totalSupply;
    mapping(address => mapping(address => uint256)) internal _allowances;
    address internal _owner;

    // unused, required to keep the same layout as it was in the previous version of the token contract.
    bool internal _mintingFinished;

    address internal _bridgeContract;
    bytes32 internal _DOMAIN_SEPARATOR;
    mapping(address => uint256) internal _nonces;
    mapping(address => mapping(address => uint256)) internal _expirations;
}
