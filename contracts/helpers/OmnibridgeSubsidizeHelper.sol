pragma solidity 0.7.5;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "../interfaces/IOmnibridge.sol";
import "../interfaces/IERC677.sol";
import "../libraries/AddressHelper.sol";
import "../libraries/Bytes.sol";
import "../upgradeable_contracts/modules/OwnableModule.sol";
import "../upgradeable_contracts/modules/fee_manager/OmnibridgeFeeManager.sol";
import "../upgradeable_contracts/Claimable.sol";

/**
 * @title OmnibridgeSubsidizeHelper
 * @dev Intermediary helper contract for taking extra fees for automatic claim.
 */
contract OmnibridgeSubsidizeHelper is IOmnibridge, OwnableModule, Claimable {
    using SafeERC20 for IERC677;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IOmnibridge public immutable bridge;
    OmnibridgeFeeManager public feeManager;

    mapping(address => bool) public enabledTokens;

    bytes32 public constant HOME_TO_FOREIGN_FEE = 0x741ede137d0537e88e0ea0ff25b1f22d837903dbbee8980b4a06e8523247ee26; // keccak256(abi.encodePacked("homeToForeignFee"))

    /**
     * @dev Initializes this contract.
     * @param _bridge address of the HomeOmnibridge/ForeignOmnibridge contract.
     * @param _owner address of the contract owner.
     */
    constructor(IOmnibridge _bridge, address _owner) OwnableModule(_owner) {
        bridge = _bridge;
    }

    /**
     * @dev Sets the fee manager address.
     * @param _feeManager address of the OmnibridgeFeeManager contract.
     */
    function setFeeManager(OmnibridgeFeeManager _feeManager) external onlyOwner {
        feeManager = _feeManager;
    }

    /**
     * @dev Enables/disables automatic claim for some particular token contract address.
     * @param _token address of the token contract.
     * @param _enabled true to enable automatic claim.
     */
    function enableToken(address _token, bool _enabled) external onlyOwner {
        enabledTokens[_token] = _enabled;
    }

    /**
     * @dev ERC677 transfer callback function.
     * Subtracts a configured fee and bridges the remaining amount to the regular OB.
     * @param _from address of tokens sender.
     * @param _value amount of transferred tokens.
     * @param _data additional transfer data, can be used for passing alternative receiver address.
     */
    function onTokenTransfer(
        address _from,
        uint256 _value,
        bytes memory _data
    ) external returns (bool) {
        uint256 valueToBridge = _distributeFee(msg.sender, _from, _value);
        IERC677(msg.sender).transferAndCall(address(bridge), valueToBridge, _data);

        return true;
    }

    /**
     * @dev Initiate the bridge operation for some amount of tokens from msg.sender to msg.sender on the other side.
     * The user should first call Approve method of the ERC677 token.
     * Subtracts a configured fee and bridges the remaining amount to the regular OB.
     * @param _token bridged token contract address.
     * @param _value amount of tokens to be transferred to the other network.
     */
    function relayTokens(address _token, uint256 _value) external override {
        relayTokens(_token, msg.sender, _value);
    }

    /**
     * @dev Initiate the bridge operation for some amount of tokens from msg.sender.
     * The user should first call Approve method of the ERC677 token.
     * Subtracts a configured fee and bridges the remaining amount to the regular OB.
     * @param _token bridged token contract address.
     * @param _receiver address that will receive tokens on the other network.
     * @param _value amount of tokens to be transferred to the other network.
     */
    function relayTokens(
        address _token,
        address _receiver,
        uint256 _value
    ) public override {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _value);
        uint256 valueToBridge = _distributeFee(_token, msg.sender, _value);
        IERC20(_token).approve(address(bridge), valueToBridge);
        bridge.relayTokens(_token, _receiver, valueToBridge);
    }

    /**
     * @dev Initiate the bridge operation for some amount of tokens from msg.sender.
     * The user should first call Approve method of the ERC677 token.
     * Subtracts a configured fee and bridges the remaining amount to the regular OB.
     * @param _token bridged token contract address.
     * @param _receiver address that will receive the native tokens on the other network.
     * @param _value amount of tokens to be transferred to the other network.
     * @param _data additional transfer data to be used on the other side.
     */
    function relayTokensAndCall(
        address _token,
        address _receiver,
        uint256 _value,
        bytes memory _data
    ) external override {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _value);
        uint256 valueToBridge = _distributeFee(_token, msg.sender, _value);
        IERC20(_token).approve(address(bridge), valueToBridge);
        bridge.relayTokensAndCall(_token, _receiver, valueToBridge, _data);
    }

    function _distributeFee(
        address _token,
        address _from,
        uint256 _value
    ) internal returns (uint256) {
        require(enabledTokens[_token]);

        uint256 fee = feeManager.calculateFee(HOME_TO_FOREIGN_FEE, _token, _from, _value);
        IERC677(_token).safeTransfer(address(feeManager), fee);
        feeManager.distributeFee(_token);
        return _value.sub(fee);
    }

    /**
     * @dev Claims stuck coins/tokens.
     * Only contract owner can call this method.
     * @param _token address of claimed token contract, address(0) for native coins.
     * @param _to address of tokens receiver
     */
    function claimTokens(address _token, address _to) external onlyOwner {
        claimValues(_token, _to);
    }

    function calculateFee(
        address _token,
        address _from,
        uint256 _value
    ) external view returns (uint256) {
        return feeManager.calculateFee(HOME_TO_FOREIGN_FEE, _token, _from, _value);
    }
}
