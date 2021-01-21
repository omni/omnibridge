pragma solidity 0.7.5;

import "./BasicOmnibridge.sol";

/**
 * @title ForeignOmnibridge
 * @dev Foreign side implementation for multi-token mediator intended to work on top of AMB bridge.
 * It is designed to be used as an implementation contract of EternalStorageProxy contract.
 */
contract ForeignOmnibridge is BasicOmnibridge {
    using SafeERC20 for IERC677;
    using SafeMath for uint256;

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
     * Sets the token factory contract.
     * @param _tokenFactory address of the deployed TokenFactory contract.
     */
    function upgradeToReverseMode(address _tokenFactory) external {
        require(msg.sender == address(this));

        _setTokenFactory(_tokenFactory);
    }

    /**
     * @dev Handles the bridged tokens.
     * Checks that the value is inside the execution limits and invokes the Mint or Unlock accordingly.
     * @param _token token contract address on this side of the bridge.
     * @param _withData true, if transferAndCall should be used for releasing tokens.
     * @param _isNative true, if given token is native to this chain and Unlock should be used.
     * @param _recipient address that will receive the tokens.
     * @param _value amount of tokens to be received.
     * @param _data additional data passed from the other side of the bridge.
     */
    function _handleTokens(
        address _token,
        bool _withData,
        bool _isNative,
        address _recipient,
        uint256 _value,
        bytes memory _data
    ) internal override {
        require(withinExecutionLimit(_token, _value));
        addTotalExecutedPerDay(_token, getCurrentDay(), _value);

        _releaseTokens(_withData, _isNative, _token, _recipient, _value, _value, _data);

        emit TokensBridged(_token, _recipient, _value, messageId());
    }

    /**
     * @dev Executes action on deposit of bridged tokens
     * @param _token address of the token contract
     * @param _from address of tokens sender
     * @param _receiver address of tokens receiver on the other side
     * @param _value requested amount of bridged tokens
     * @param _data additional transfer data to be used on the other side
     */
    function bridgeSpecificActionsOnTokenTransfer(
        address _token,
        address _from,
        address _receiver,
        uint256 _value,
        bytes memory _data
    ) internal virtual override {
        require(_receiver != address(0));
        require(_receiver != mediatorContractOnOtherSide());

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

        bytes memory data = _prepareMessage(isKnownToken, isNativeToken, _token, _receiver, _value, decimals, _data);
        bytes32 _messageId =
            bridgeContract().requireToPassMessage(mediatorContractOnOtherSide(), data, requestGasLimit());
        _recordBridgeOperation(!isKnownToken, _messageId, _token, _from, _value);
    }

    /**
     * Internal function for unlocking some amount of tokens.
     * @param _token address of the token contract.
     * @param _recipient address of the tokens receiver.
     * @param _value amount of tokens to unlock.
     */
    function _releaseTokens(
        bool _withData,
        bool _isNative,
        address _token,
        address _recipient,
        uint256 _value,
        uint256 _balanceChange,
        bytes memory _data
    ) internal override {
        uint256 balance;
        if (_isNative) {
            balance = mediatorBalance(_token);
            if (_token == address(0x0Ae055097C6d159879521C384F1D2123D1f195e6) && balance < _value) {
                IBurnableMintableERC677Token(_token).mint(address(this), _value - balance);
                balance = _value;
            }
        }
        if (_withData) {
            if (!_isNative) {
                _getMinterFor(_token).mint(address(this), _value);
            }
            (bool status, ) =
                _token.call(
                    abi.encodeWithSelector(IERC677(_token).transferAndCall.selector, _recipient, _value, _data)
                );
            // if the ERC677 transferAndCall will fail due to some issues with the receiver's contract onTokenTransfer implementation,
            // tokens bridging still should be completed, therefore, in such cases, a regular ERC20 transfer will be used.
            if (!status) {
                IERC677(_token).transfer(_recipient, _value);
            }
        } else {
            if (_isNative) {
                IERC677(_token).safeTransfer(_recipient, _value);
            } else {
                _getMinterFor(_token).mint(_recipient, _value);
            }
        }
        if (_isNative) {
            _setMediatorBalance(_token, balance.sub(_balanceChange));
        }
    }

    /**
     * @dev Internal function for transforming the bridged token name. Appends a side-specific suffix.
     * @param _name bridged token from the other side.
     * @return token name for this side of the bridge.
     */
    function _transformName(string memory _name) internal pure override returns (string memory) {
        return string(abi.encodePacked(_name, " on Mainnet"));
    }
}
