pragma solidity 0.7.5;

import "./BasicOmnibridge.sol";
import "./modules/forwarding_rules/MultiTokenForwardingRulesConnector.sol";
import "./modules/fee_manager/OmnibridgeFeeManagerConnector.sol";

/**
 * @title HomeOmnibridge
 * @dev Home side implementation for multi-token mediator intended to work on top of AMB bridge.
 * It is designed to be used as an implementation contract of EternalStorageProxy contract.
 */
contract HomeOmnibridge is BasicOmnibridge, OmnibridgeFeeManagerConnector, MultiTokenForwardingRulesConnector {
    using SafeMath for uint256;
    using SafeERC20 for IERC677;

    /**
     * @dev Stores the initial parameters of the mediator.
     * @param _bridgeContract the address of the AMB bridge contract.
     * @param _mediatorContract the address of the mediator contract on the other network.
     * @param _dailyLimitMaxPerTxMinPerTxArray array with limit values for the assets to be bridged to the other network.
     *   [ 0 = dailyLimit, 1 = maxPerTx, 2 = minPerTx ]
     * @param _executionDailyLimitExecutionMaxPerTxArray array with limit values for the assets bridged from the other network.
     *   [ 0 = executionDailyLimit, 1 = executionMaxPerTx ]
     * @param _requestGasLimit the gas limit for the message execution.
     * @param _owner address of the owner of the mediator contract.
     * @param _tokenFactory address of the TokenFactory contract that will be used for the deployment of new tokens.
     */
    function initialize(
        address _bridgeContract,
        address _mediatorContract,
        uint256[3] calldata _dailyLimitMaxPerTxMinPerTxArray, // [ 0 = _dailyLimit, 1 = _maxPerTx, 2 = _minPerTx ]
        uint256[2] calldata _executionDailyLimitExecutionMaxPerTxArray, // [ 0 = _executionDailyLimit, 1 = _executionMaxPerTx ]
        uint256 _requestGasLimit,
        address _owner,
        address _tokenFactory
    ) external onlyRelevantSender returns (bool) {
        require(!isInitialized());

        _setBridgeContract(_bridgeContract);
        _setMediatorContractOnOtherSide(_mediatorContract);
        _setLimits(address(0), _dailyLimitMaxPerTxMinPerTxArray);
        _setExecutionLimits(address(0), _executionDailyLimitExecutionMaxPerTxArray);
        _setRequestGasLimit(_requestGasLimit);
        _setOwner(_owner);
        _setTokenFactory(_tokenFactory);

        setInitialize();

        return isInitialized();
    }

    /**
     * One-time function to be used together with upgradeToAndCall method.
     * Sets the token factory contract. Resumes token bridging in the home to foreign direction.
     * @param _tokenFactory address of the deployed TokenFactory contract.
     * @param _forwardingRulesManager address of the deployed MultiTokenForwardingRulesManager contract.
     * @param _dailyLimit default daily limits used before stopping the bridge operation.
     */
    function upgradeToReverseMode(
        address _tokenFactory,
        address _forwardingRulesManager,
        uint256 _dailyLimit
    ) external {
        require(msg.sender == address(this));

        _setTokenFactory(_tokenFactory);
        _setForwardingRulesManager(_forwardingRulesManager);

        uintStorage[keccak256(abi.encodePacked("dailyLimit", address(0)))] = _dailyLimit;
        emit DailyLimitChanged(address(0), _dailyLimit);
    }

    /**
     * @dev Alias for bridgedTokenAddress for interface compatibility with the prior version of the Home mediator.
     * @param _foreignToken address of the native token contract on the other side.
     * @return address of the deployed bridged token contract.
     */
    function homeTokenAddress(address _foreignToken) public view returns (address) {
        return bridgedTokenAddress(_foreignToken);
    }

    /**
     * @dev Alias for nativeTokenAddress for interface compatibility with the prior version of the Home mediator.
     * @param _homeToken address of the created bridged token contract on this side.
     * @return address of the native token contract on the other side of the bridge.
     */
    function foreignTokenAddress(address _homeToken) public view returns (address) {
        return nativeTokenAddress(_homeToken);
    }

    /**
     * @dev Handles the bridged tokens.
     * Checks that the value is inside the execution limits and invokes the Mint or Unlock accordingly.
     * @param _token token contract address on this side of the bridge.
     * @param _isNative true, if given token is native to this chain and Unlock should be used.
     * @param _recipient address that will receive the tokens.
     * @param _value amount of tokens to be received.
     */
    function _handleTokens(
        address _token,
        bool _isNative,
        address _recipient,
        uint256 _value
    ) internal override {
        require(withinExecutionLimit(_token, _value));
        addTotalExecutedPerDay(_token, getCurrentDay(), _value);

        uint256 valueToBridge = _value;
        uint256 fee = _distributeFee(FOREIGN_TO_HOME_FEE, _isNative, address(0), _token, valueToBridge);
        bytes32 _messageId = messageId();
        if (fee > 0) {
            emit FeeDistributed(fee, _token, _messageId);
            valueToBridge = valueToBridge.sub(fee);
        }

        if (_isNative) {
            // not _releaseTokens(_token, _recipient, _value), since valueToBridge < _value
            IERC677(_token).safeTransfer(_recipient, valueToBridge);
            _setMediatorBalance(_token, mediatorBalance(_token).sub(_value));
        } else {
            _getMinterFor(_token).mint(_recipient, valueToBridge);
        }

        emit TokensBridged(_token, _recipient, valueToBridge, _messageId);
    }

    /**
     * @dev Executes action on deposit of bridged tokens
     * @param _token address of the token contract
     * @param _from address of tokens sender
     * @param _receiver address of tokens receiver on the other side
     * @param _value requested amount of bridged tokens
     */
    function bridgeSpecificActionsOnTokenTransfer(
        address _token,
        address _from,
        address _receiver,
        uint256 _value
    ) internal override {
        uint8 decimals;
        bool isKnownToken = isTokenRegistered(_token);
        bool isNativeToken = !isKnownToken || isRegisteredAsNativeToken(_token);

        // native unbridged token
        if (!isKnownToken) {
            decimals = uint8(TokenReader.readDecimals(_token));
            _initializeTokenBridgeLimits(_token, decimals);
        }

        require(withinLimit(_token, _value));
        addTotalSpentPerDay(_token, getCurrentDay(), _value);

        uint256 fee = _distributeFee(HOME_TO_FOREIGN_FEE, isNativeToken, _from, _token, _value);
        uint256 valueToBridge = _value.sub(fee);

        bytes memory data = _prepareMessage(isKnownToken, isNativeToken, _token, _receiver, valueToBridge, decimals);

        bytes32 _messageId = _passMessage(data, _token, _from, _receiver);
        _recordBridgeOperation(!isKnownToken, _messageId, _token, _from, valueToBridge);
        if (fee > 0) {
            emit FeeDistributed(fee, _token, _messageId);
        }
    }

    /**
     * @dev Internal function for sending an AMB message.
     * Takes into account forwarding rules from forwardingRulesManager().
     * @param _data data to be sent to the other side of the bridge.
     * @param _token address of the home token contract within the bridged pair.
     * @param _from address of the tokens sender.
     * @param _receiver address of the tokens receiver on the other side.
     * @return id of the sent message.
     */
    function _passMessage(
        bytes memory _data,
        address _token,
        address _from,
        address _receiver
    ) internal returns (bytes32) {
        address executor = mediatorContractOnOtherSide();
        uint256 gasLimit = requestGasLimit();
        IAMB bridge = bridgeContract();

        // Address of the home token is used here for determining lane permissions.
        return
            _isOracleDrivenLaneAllowed(_token, _from, _receiver)
                ? bridge.requireToPassMessage(executor, _data, gasLimit)
                : bridge.requireToConfirmMessage(executor, _data, gasLimit);
    }

    /**
     * @dev Internal function for transforming the bridged token name. Appends a side-specific suffix.
     * @param _name bridged token from the other side.
     * @return token name for this side of the bridge.
     */
    function _transformName(string memory _name) internal pure override returns (string memory) {
        return string(abi.encodePacked(_name, " on xDai"));
    }

    /**
     * @dev Internal function for getting minter proxy address.
     * Returns the token address itself, expect for the case with bridged STAKE token.
     * For bridged STAKE token, returns the hardcoded TokenMinter contract address.
     * @param _token address of the token to mint.
     * @return address of the minter contract that should be used for calling mint(address,uint256)
     */
    function _getMinterFor(address _token)
        internal
        view
        override(BasicOmnibridge, OmnibridgeFeeManagerConnector)
        returns (IBurnableMintableERC677Token)
    {
        if (_token == address(0xb7D311E2Eb55F2f68a9440da38e7989210b9A05e)) {
            // hardcoded address of the TokenMinter address
            return IBurnableMintableERC677Token(0xb7D311E2Eb55F2f68a9440da38e7989210b9A05e);
        }
        return IBurnableMintableERC677Token(_token);
    }
}
