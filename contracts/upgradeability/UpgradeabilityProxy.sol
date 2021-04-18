pragma solidity 0.7.5;

import "@openzeppelin/contracts/utils/Address.sol";
import "./Proxy.sol";
import "./UpgradeabilityStorage.sol";

/**
 * @title UpgradeabilityProxy
 * @dev This contract represents a proxy where the implementation address to which it will delegate can be upgraded
 */
contract UpgradeabilityProxy is Proxy, UpgradeabilityStorage {
    /**
     * @dev This event will be emitted every time the implementation gets upgraded
     * @param version representing the version name of the upgraded implementation
     * @param implementation representing the address of the upgraded implementation
     */
    event Upgraded(uint256 version, address indexed implementation);

    /**
     * @dev Tells the address of the current implementation
     * @return address of the current implementation
     */
    function implementation() public view override(Proxy, UpgradeabilityStorage) returns (address) {
        return UpgradeabilityStorage.implementation();
    }

    /**
     * @dev Upgrades the implementation address
     * @param version representing the version name of the new implementation to be set
     * @param implementation representing the address of the new implementation to be set
     */
    function _upgradeTo(uint256 version, address implementation) internal {
        require(_implementation != implementation);

        // This additional check verifies that provided implementation is at least a contract
        require(Address.isContract(implementation));

        // This additional check guarantees that new version will be at least greater than the previous one,
        // so it is impossible to reuse old versions, or use the last version twice
        require(version > _version);

        _version = version;
        _implementation = implementation;
        emit Upgraded(version, implementation);
    }
}
