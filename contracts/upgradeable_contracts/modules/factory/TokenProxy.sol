pragma solidity 0.7.5;

import "../../../upgradeability/Proxy.sol";
import "../../../tokens/TokenStorageLayout.sol";

interface IPermittableTokenVersion {
    function version() external pure returns (string memory);
}

/**
 * @title TokenProxy
 * @dev Helps to reduces the size of the deployed bytecode for automatically created tokens, by using a proxy contract.
 */
contract TokenProxy is Proxy, TokenStorageLayout {
    /**
     * @dev Creates a non-upgradeable token proxy for PermitableToken.sol, initializes its eternalStorage.
     * @param _tokenImage address of the token image used for mirroring all functions.
     * @param name token name.
     * @param symbol token symbol.
     * @param decimals token decimals.
     * @param owner address of the owner for this contract.
     */
    constructor(
        address _tokenImage,
        string memory name,
        string memory symbol,
        uint8 decimals,
        address owner
    ) {
        string memory version = IPermittableTokenVersion(_tokenImage).version();
        uint256 chainId;

        assembly {
            chainId := chainid()
            // EIP 1967
            // bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
            sstore(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc, _tokenImage)
        }
        _name = name;
        _symbol = symbol;
        _decimals = decimals;
        _owner = owner; // owner == HomeOmnibridge/ForeignOmnibridge mediator
        bridgeContractAddr = owner;
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                address(this)
            )
        );
    }

    /**
     * @dev Retrieves the implementation contract address, mirrored token image.
     * @return impl token image address.
     */
    function implementation() public view override returns (address impl) {
        assembly {
            impl := sload(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)
        }
    }
}
