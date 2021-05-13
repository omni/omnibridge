pragma solidity 0.7.5;

import "./openzeppelin/ERC20.sol";
import "./openzeppelin/OwnableToken.sol";
import "../upgradeable_contracts/Claimable.sol";
import "../interfaces/IClaimable.sol";

/**
 * @title BridgedToken
 * @dev The basic implementation of a bridgeable ERC20 token.
 */
contract BridgedToken is ERC20, Claimable, OwnableToken, IClaimable {
    /**
     * @dev Tells the address of the bridge contract responsible for bridging these tokens.
     * @return address of bridge contract.
     */
    function bridgeContract() external view returns (address) {
        return _bridgeContract;
    }

    /**
     * @dev Updates address of the associated bridge contract.
     * Only owner can call this method.
     * @param _bridge address of the new contract.
     */
    function setBridgeContract(address _bridge) external onlyOwner {
        require(Address.isContract(_bridge));
        _bridgeContract = _bridge;
    }

    /**
     * @dev Tells the token interface version that this contract supports.
     * @return major value of the version.
     * @return minor value of the version.
     * @return patch value of the version.
     */
    function getTokenInterfacesVersion()
        external
        pure
        returns (
            uint64 major,
            uint64 minor,
            uint64 patch
        )
    {
        return (3, 0, 0);
    }

    /**
     * @dev Checks is a given contract address can bridge this token.
     * @param _address Contract address to check.
     * @return true, if the token can be bridged through the given contract.
     */
    function isBridge(address _address) public view virtual returns (bool) {
        return _address == _bridgeContract;
    }

    /**
     * @dev Mints new tokens to the given address.
     * Only owner can call this method.
     * @param _to address where to send newly created tokens.
     * @param _value amount of minted tokens.
     * @return true, if operation succeeded.
     */
    function mint(address _to, uint256 _value) external onlyOwner returns (bool) {
        _mint(_to, _value);
        return true;
    }

    /**
     * @dev Burns new given amount of tokens. Reduces the total tokens supply.
     * @param _value amount of tokens to burn.
     */
    function burn(uint256 _value) external {
        _burn(msg.sender, _value);
    }

    /**
     * @dev Withdraws the erc20 tokens or native coins from this contract.
     * Only owner can call this method.
     * @param _token address of the claimed token or address(0) for native coins.
     * @param _to address of the tokens/coins receiver.
     */
    function claimTokens(address _token, address _to) external override onlyOwner {
        claimValues(_token, _to);
    }
}
