pragma solidity 0.7.5;

import "../interfaces/IOmnibridge.sol";
import "../interfaces/IWETH.sol";
import "../libraries/AddressHelper.sol";
import "../upgradeable_contracts/modules/OwnableModule.sol";
import "../upgradeable_contracts/Claimable.sol";

contract WETHOmnibridgeRouter is OwnableModule, Claimable {
    IOmnibridge public immutable bridge;
    // solhint-disable-next-line var-name-mixedcase
    IWETH public immutable WETH;

    constructor(
        IOmnibridge _bridge,
        IWETH _weth,
        address _owner
    ) OwnableModule(_owner) {
        bridge = _bridge;
        WETH = _weth;
        _weth.approve(address(_bridge), uint256(-1));
    }

    function wrapAndRelayTokens(address _receiver) external payable {
        WETH.deposit{ value: msg.value }();
        bridge.relayTokens(address(WETH), _receiver, msg.value);
    }

    function onTokenBridged(
        address _token,
        uint256 _value,
        bytes calldata _data
    ) external {
        require(_token == address(WETH));
        require(msg.sender == address(bridge));
        require(_data.length == 20);

        WETH.withdraw(_value);

        address payable receiver;
        assembly {
            receiver := calldataload(120)
        }
        AddressHelper.safeSendValue(receiver, _value);
    }

    function claimTokens(address _token, address _to) external onlyOwner {
        claimValues(_token, _to);
    }

    receive() external payable {
        require(msg.sender == address(WETH));
    }
}
