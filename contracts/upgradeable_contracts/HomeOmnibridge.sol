pragma solidity 0.7.5;

import "./BasicOmnibridge.sol";
import "./HomeOmnibridgeFeeManager.sol";
import "./modules/forwarding_rules/MultiTokenForwardingRulesConnector.sol";

/**
 * @title HomeOmnibridge
 * @dev Home side implementation for multi-token mediator intended to work on top of AMB bridge.
 * It is designed to be used as an implementation contract of EternalStorageProxy contract.
 */
contract HomeOmnibridge is BasicOmnibridge, HomeOmnibridgeFeeManager, MultiTokenForwardingRulesConnector {
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
     * @param _rewardAddresses list of reward addresses, between whom fees will be distributed.
     * @param _fees array with initial fees for both bridge directions.
     *   [ 0 = homeToForeignFee, 1 = foreignToHomeFee ]
     */
    function initialize(
        address _bridgeContract,
        address _mediatorContract,
        uint256[3] calldata _dailyLimitMaxPerTxMinPerTxArray, // [ 0 = _dailyLimit, 1 = _maxPerTx, 2 = _minPerTx ]
        uint256[2] calldata _executionDailyLimitExecutionMaxPerTxArray, // [ 0 = _executionDailyLimit, 1 = _executionMaxPerTx ]
        uint256 _requestGasLimit,
        address _owner,
        address _tokenFactory,
        address[] calldata _rewardAddresses,
        uint256[2] calldata _fees // [ 0 = homeToForeignFee, 1 = foreignToHomeFee ]
    ) external onlyRelevantSender returns (bool) {
        require(!isInitialized());

        _setBridgeContract(_bridgeContract);
        _setMediatorContractOnOtherSide(_mediatorContract);
        _setLimits(address(0), _dailyLimitMaxPerTxMinPerTxArray);
        _setExecutionLimits(address(0), _executionDailyLimitExecutionMaxPerTxArray);
        _setRequestGasLimit(0x00000000, _requestGasLimit);
        _setOwner(_owner);
        _setTokenFactory(_tokenFactory);
        if (_rewardAddresses.length > 0) {
            _setRewardAddressList(_rewardAddresses);
        }
        _setFee(HOME_TO_FOREIGN_FEE, address(0), _fees[0]);
        _setFee(FOREIGN_TO_HOME_FEE, address(0), _fees[1]);

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
        uint256 fee = _distributeFee(FOREIGN_TO_HOME_FEE, _isNative, _token, valueToBridge);
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
            _initToken(_token, decimals);
        }

        require(withinLimit(_token, _value));
        addTotalSpentPerDay(_token, getCurrentDay(), _value);

        uint256 valueToBridge = _value;
        uint256 fee = 0;
        // Next line disables fee collection in case sender is one of the reward addresses.
        // It is needed to allow a 100% withdrawal of tokens from the home side.
        // If fees are not disabled for reward receivers, small fraction of tokens will always
        // be redistributed between the same set of reward addresses, which is not the desired behaviour.
        if (!isRewardAddress(_from)) {
            fee = _distributeFee(HOME_TO_FOREIGN_FEE, isNativeToken, _token, valueToBridge);
            valueToBridge = valueToBridge.sub(fee);
        }

        bytes memory data = _prepareMessage(isKnownToken, isNativeToken, _token, _receiver, valueToBridge, decimals);

        // Address of the home token is used here for determining lane permissions.
        bytes32 _messageId = _passMessage(data, _isOracleDrivenLaneAllowed(_token, _from, _receiver));
        _recordBridgeOperation(!isKnownToken, _messageId, _token, _from, valueToBridge);
        if (fee > 0) {
            emit FeeDistributed(fee, _token, _messageId);
        }
    }

    /**
     * @dev Internal function for sending an AMB message to the mediator on the other side.
     * @param _data data to be sent to the other side of the bridge.
     * @param _useOracleLane true, if the message should be sent to the oracle driven lane.
     * @return id of the sent message.
     */
    function _passMessage(bytes memory _data, bool _useOracleLane) internal override returns (bytes32) {
        address executor = mediatorContractOnOtherSide();
        bytes4 selector;
        assembly {
            selector := shl(mload(add(_data, 4)), 224)
        }
        uint256 gasLimit = requestGasLimit(selector);
        if (gasLimit == 0) {
            gasLimit = requestGasLimit(0x00000000);
        }
        IAMB bridge = bridgeContract();

        return
            _useOracleLane
                ? bridge.requireToPassMessage(executor, _data, gasLimit)
                : bridge.requireToConfirmMessage(executor, _data, gasLimit);
    }

    /**
     * @dev Internal function for initializing newly bridged token related information.
     * @param _token address of the token contract.
     * @param _decimals token decimals parameter.
     */
    function _initToken(address _token, uint8 _decimals) internal override {
        super._initToken(_token, _decimals);
        _setFee(HOME_TO_FOREIGN_FEE, _token, getFee(HOME_TO_FOREIGN_FEE, address(0)));
        _setFee(FOREIGN_TO_HOME_FEE, _token, getFee(FOREIGN_TO_HOME_FEE, address(0)));
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
        override(BasicOmnibridge, HomeOmnibridgeFeeManager)
        returns (IBurnableMintableERC677Token)
    {
        if (_token == address(0xb7D311E2Eb55F2f68a9440da38e7989210b9A05e)) {
            // hardcoded address of the TokenMinter address
            return IBurnableMintableERC677Token(0xb7D311E2Eb55F2f68a9440da38e7989210b9A05e);
        }
        return IBurnableMintableERC677Token(_token);
    }
}
