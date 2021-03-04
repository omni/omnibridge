pragma solidity 0.7.5;

import "./openzeppelin/ERC20.sol";
import "./openzeppelin/OwnableToken.sol";
import "../upgradeable_contracts/Claimable.sol";
import "../interfaces/IClaimable.sol";

/**
 * @title BridgedToken
 * @dev The basic implementation of a bridgeable token.
 */
contract BridgedToken is ERC20, Claimable, OwnableToken, IClaimable {
    function bridgeContract() external view returns (address) {
        return bridgeContractAddr;
    }

    function setBridgeContract(address _bridgeContract) external onlyOwner {
        require(Address.isContract(_bridgeContract));
        bridgeContractAddr = _bridgeContract;
    }

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

    function isBridge(address _address) public view virtual returns (bool) {
        return _address == bridgeContractAddr;
    }

    function mint(address _to, uint256 _value) external onlyOwner returns (bool) {
        _mint(_to, _value);
        return true;
    }

    function burn(uint256 _value) external {
        _burn(msg.sender, _value);
    }

    /**
     * @dev Withdraws the erc20 tokens or native coins from this contract.
     * @param _token address of the claimed token or address(0) for native coins.
     * @param _to address of the tokens/coins receiver.
     */
    function claimTokens(address _token, address _to) external override onlyOwner {
        claimValues(_token, _to);
    }
}
