pragma solidity 0.7.5;

import "./Ownable.sol";
import "../interfaces/IAMB.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title BasicAMBMediator
 * @dev Basic storage and methods needed by mediators to interact with AMB bridge.
 */
abstract contract BasicAMBMediator is Ownable {
    bytes32 internal constant BRIDGE_CONTRACT = 0x811bbb11e8899da471f0e69a3ed55090fc90215227fc5fb1cb0d6e962ea7b74f; // keccak256(abi.encodePacked("bridgeContract"))
    bytes32 internal constant MEDIATOR_CONTRACT = 0x98aa806e31e94a687a31c65769cb99670064dd7f5a87526da075c5fb4eab9880; // keccak256(abi.encodePacked("mediatorContract"))
    bytes32 internal constant REQUEST_GAS_LIMIT = 0x2dfd6c9f781bb6bbb5369c114e949b69ebb440ef3d4dd6b2836225eb1dc3a2be; // keccak256(abi.encodePacked("requestGasLimit"))

    /**
     * @dev Throws if caller on the other side is not an associated mediator.
     */
    modifier onlyMediator {
        _onlyMediator();
        _;
    }

    /**
     * @dev Internal function for reducing onlyMediator modifier bytecode overhead.
     */
    function _onlyMediator() internal view {
        require(msg.sender == address(bridgeContract()));
        require(messageSender() == mediatorContractOnOtherSide());
    }

    /**
     * @dev Sets the AMB bridge contract address. Only the owner can call this method.
     * @param _bridgeContract the address of the bridge contract.
     */
    function setBridgeContract(address _bridgeContract) external onlyOwner {
        _setBridgeContract(_bridgeContract);
    }

    /**
     * @dev Sets the mediator contract address from the other network. Only the owner can call this method.
     * @param _mediatorContract the address of the mediator contract.
     */
    function setMediatorContractOnOtherSide(address _mediatorContract) external onlyOwner {
        _setMediatorContractOnOtherSide(_mediatorContract);
    }

    /**
     * @dev Sets the gas limit to be used in the message execution by the AMB bridge on the other network.
     * This value can't exceed the parameter maxGasPerTx defined on the AMB bridge.
     * Only the owner can call this method.
     * @param _selector method selector of the outgoing message payload.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function setRequestGasLimit(bytes4 _selector, uint256 _gasLimit) external onlyOwner {
        _setRequestGasLimit(_selector, _gasLimit);
    }

    /**
     * @dev Get the AMB interface for the bridge contract address
     * @return AMB interface for the bridge contract address
     */
    function bridgeContract() public view returns (IAMB) {
        return IAMB(addressStorage[BRIDGE_CONTRACT]);
    }

    /**
     * @dev Tells the mediator contract address from the other network.
     * @return the address of the mediator contract.
     */
    function mediatorContractOnOtherSide() public view virtual returns (address) {
        return addressStorage[MEDIATOR_CONTRACT];
    }

    /**
     * @dev Tells the gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector for the passed message, use 0x00000000 for setting the default gas limit.
     * @return the gas limit for the message execution.
     */
    function requestGasLimit(bytes4 _selector) public view returns (uint256) {
        return uintStorage[REQUEST_GAS_LIMIT ^ _selector];
    }

    /**
     * @dev Stores a valid AMB bridge contract address.
     * @param _bridgeContract the address of the bridge contract.
     */
    function _setBridgeContract(address _bridgeContract) internal {
        require(Address.isContract(_bridgeContract));
        addressStorage[BRIDGE_CONTRACT] = _bridgeContract;
    }

    /**
     * @dev Stores the mediator contract address from the other network.
     * @param _mediatorContract the address of the mediator contract.
     */
    function _setMediatorContractOnOtherSide(address _mediatorContract) internal {
        addressStorage[MEDIATOR_CONTRACT] = _mediatorContract;
    }

    /**
     * @dev Stores the gas limit to be used in the message execution by the AMB bridge on the other network.
     * @param _selector method selector of the outgoing message payload, use 0x00000000 for setting the default gas limit.
     * @param _gasLimit the gas limit fot the message execution.
     */
    function _setRequestGasLimit(bytes4 _selector, uint256 _gasLimit) internal {
        require(_gasLimit <= maxGasPerTx());
        uintStorage[REQUEST_GAS_LIMIT ^ _selector] = _gasLimit;
    }

    /**
     * @dev Tells the address that generated the message on the other network that is currently being executed by
     * the AMB bridge.
     * @return the address of the message sender.
     */
    function messageSender() internal view returns (address) {
        return bridgeContract().messageSender();
    }

    /**
     * @dev Tells the id of the message originated on the other network.
     * @return the id of the message originated on the other network.
     */
    function messageId() internal view returns (bytes32) {
        return bridgeContract().messageId();
    }

    /**
     * @dev Tells the maximum gas limit that a message can use on its execution by the AMB bridge on the other network.
     * @return the maximum gas limit value.
     */
    function maxGasPerTx() internal view returns (uint256) {
        return bridgeContract().maxGasPerTx();
    }

    function _passMessage(bytes memory _data, bool _useOracleLane) internal virtual returns (bytes32);
}
