pragma solidity 0.7.5;

import "../tokens/OmnibridgeTokenImage.sol";

contract ERC677Mock is OmnibridgeTokenImage {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) {
        uint256 chainId;

        assembly {
            chainId := chainid()
        }
        _name = name;
        _symbol = symbol;
        _decimals = decimals;
        _owner = msg.sender;
        bridgeContractAddr = msg.sender;
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    // mock function to prevent calls of onTokenTransfer on owner address in transfer() and transferFrom()
    function isBridge(address) public view override returns (bool) {
        return false;
    }
}
