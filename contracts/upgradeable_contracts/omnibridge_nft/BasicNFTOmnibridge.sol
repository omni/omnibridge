pragma solidity 0.7.5;

import "../Initializable.sol";
import "../Upgradeable.sol";
import "../omnibridge/components/common/BridgeOperationsStorage.sol";
import "../omnibridge/components/common/FailedMessagesProcessor.sol";
import "../omnibridge/components/native/NativeTokensRegistry.sol";
import "../omnibridge/components/bridged/BridgedTokensRegistry.sol";
import "./components/common/NFTBridgeLimits.sol";
import "./components/common/ERC721Relayer.sol";
import "./components/common/NFTOmnibridgeInfo.sol";
import "./components/native/ERC721Reader.sol";
import "./components/bridged/TokenImageStorage.sol";
import "./components/bridged/ERC721TokenProxy.sol";
import "./components/native/NFTMediatorBalanceStorage.sol";
import "../../tokens/ERC721BridgeToken.sol";

/**
 * @title BasicNFTOmnibridge
 * @dev Commong functionality for multi-token mediator for ERC721 tokens intended to work on top of AMB bridge.
 */
abstract contract BasicNFTOmnibridge is
    Initializable,
    Upgradeable,
    BridgeOperationsStorage,
    BridgedTokensRegistry,
    NativeTokensRegistry,
    NFTOmnibridgeInfo,
    NFTBridgeLimits,
    ERC721Reader,
    TokenImageStorage,
    ERC721Relayer,
    NFTMediatorBalanceStorage,
    FailedMessagesProcessor
{
    /**
     * @dev Stores the initial parameters of the mediator.
     * @param _bridgeContract the address of the AMB bridge contract.
     * @param _mediatorContract the address of the mediator contract on the other network.
     * @param _dailyLimit daily limit for outgoing transfers
     * @param _executionDailyLimit daily limit for ingoing bridge operations
     * @param _requestGasLimit the gas limit for the message execution.
     * @param _owner address of the owner of the mediator contract.
     * @param _image address of the ERC721 token image.
     */
    function initialize(
        address _bridgeContract,
        address _mediatorContract,
        uint256 _dailyLimit,
        uint256 _executionDailyLimit,
        uint256 _requestGasLimit,
        address _owner,
        address _image
    ) external onlyRelevantSender returns (bool) {
        require(!isInitialized());

        _setBridgeContract(_bridgeContract);
        _setMediatorContractOnOtherSide(_mediatorContract);
        _setDailyLimit(address(0), _dailyLimit);
        _setExecutionDailyLimit(address(0), _executionDailyLimit);
        _setRequestGasLimit(_requestGasLimit);
        _setOwner(_owner);
        _setTokenImage(_image);

        setInitialize();

        return isInitialized();
    }

    /**
     * @dev Checks if specified token was already bridged at least once.
     * @param _token address of the token contract.
     * @return true, if token was already bridged.
     */
    function isTokenRegistered(address _token) public view override returns (bool) {
        return isRegisteredAsNativeToken(_token) || nativeTokenAddress(_token) != address(0);
    }

    /**
     * @dev Handles the bridged token for the first time, includes deployment of new ERC721TokenProxy contract.
     * @param _token address of the native ERC721 token on the other side.
     * @param _name name of the native token, name suffix will be appended, if empty, symbol will be used instead.
     * @param _symbol symbol of the bridged token, if empty, name will be used instead.
     * @param _recipient address that will receive the tokens.
     * @param _tokenId unique id of the bridged token.
     */
    function deployAndHandleBridgedNFT(
        address _token,
        string calldata _name,
        string calldata _symbol,
        address _recipient,
        uint256 _tokenId
    ) external onlyMediator {
        address bridgedToken = bridgedTokenAddress(_token);
        if (bridgedToken == address(0)) {
            string memory name = _name;
            string memory symbol = _symbol;
            if (bytes(name).length == 0) {
                require(bytes(symbol).length > 0);
                name = symbol;
            } else if (bytes(symbol).length == 0) {
                symbol = name;
            }
            bridgedToken = address(new ERC721TokenProxy(tokenImage(), _transformName(name), symbol, address(this)));
            _setTokenAddressPair(_token, bridgedToken);
            _initToken(bridgedToken);
        }

        _handleTokens(bridgedToken, false, _recipient, _tokenId);
    }

    /**
     * @dev Handles the bridged token for the already registered token pair.
     * Checks that the bridged token is inside the execution limits and invokes the Mint accordingly.
     * @param _token address of the native ERC721 token on the other side.
     * @param _recipient address that will receive the tokens.
     * @param _tokenId unique id of the bridged token.
     */
    function handleBridgedNFT(
        address _token,
        address _recipient,
        uint256 _tokenId
    ) external onlyMediator {
        address token = bridgedTokenAddress(_token);

        _handleTokens(token, false, _recipient, _tokenId);
    }

    /**
     * @dev Handles the bridged token that are native to this chain.
     * Checks that the bridged token is inside the execution limits and invokes the Unlock accordingly.
     * @param _token address of the native ERC721 token contract.
     * @param _recipient address that will receive the tokens.
     * @param _tokenId unique id of the bridged token.
     */
    function handleNativeNFT(
        address _token,
        address _recipient,
        uint256 _tokenId
    ) external onlyMediator {
        require(isRegisteredAsNativeToken(_token));

        _handleTokens(_token, true, _recipient, _tokenId);
    }

    /**
     * @dev Allows to pre-set the bridged token contract for not-yet bridged token.
     * Only the owner can call this method.
     * @param _nativeToken address of the token contract on the other side that was not yet bridged.
     * @param _bridgedToken address of the bridged token contract.
     */
    function setCustomTokenAddressPair(address _nativeToken, address _bridgedToken) external onlyOwner {
        require(Address.isContract(_bridgedToken));
        require(!isTokenRegistered(_bridgedToken));
        require(bridgedTokenAddress(_nativeToken) == address(0));

        _setTokenAddressPair(_nativeToken, _bridgedToken);
        _initToken(_bridgedToken);
    }

    /**
     * @dev Allows to send to the other network some ERC721 token that can be forced into the contract
     * without the invocation of the required methods. (e. g. regular transferFrom without a call to onERC721Received)
     * @param _token address of the token contract.
     * @param _receiver the address that will receive the token on the other network.
     * @param _tokenId unique id of the bridged token.
     */
    function fixMediatorBalance(
        address _token,
        address _receiver,
        uint256 _tokenId
    ) external onlyIfUpgradeabilityOwner {
        require(_receiver != address(0) && _receiver != mediatorContractOnOtherSide());
        require(isRegisteredAsNativeToken(_token));
        require(!mediatorOwns(_token, _tokenId));
        require(IERC721(_token).ownerOf(_tokenId) == address(this));

        _setMediatorOwns(_token, _tokenId, true);

        bytes memory data = abi.encodeWithSelector(this.handleBridgedNFT.selector, _token, _receiver, _tokenId);

        bytes32 _messageId =
            bridgeContract().requireToPassMessage(mediatorContractOnOtherSide(), data, requestGasLimit());
        _recordBridgeOperation(false, _messageId, _token, _receiver, _tokenId);
    }

    /**
     * @dev Executes action on deposit of ERC721 token.
     * @param _token address of the ERC721 token contract.
     * @param _from address of token sender.
     * @param _receiver address of token receiver on the other side.
     * @param _tokenId unique id of the bridged token.
     */
    function bridgeSpecificActionsOnTokenTransfer(
        address _token,
        address _from,
        address _receiver,
        uint256 _tokenId
    ) internal override {
        require(_receiver != address(0) && _receiver != mediatorContractOnOtherSide());

        bool isKnownToken = isTokenRegistered(_token);
        bool isNativeToken = !isKnownToken || isRegisteredAsNativeToken(_token);
        bytes memory data;

        if (!isKnownToken) {
            require(IERC721(_token).ownerOf(_tokenId) == address(this));

            string memory name = _readName(_token);
            string memory symbol = _readSymbol(_token);

            require(bytes(name).length > 0 || bytes(symbol).length > 0);
            _initToken(_token);

            data = abi.encodeWithSelector(
                this.deployAndHandleBridgedNFT.selector,
                _token,
                name,
                symbol,
                _receiver,
                _tokenId
            );
        } else if (isNativeToken) {
            data = abi.encodeWithSelector(this.handleBridgedNFT.selector, _token, _receiver, _tokenId);
        } else {
            IBurnableMintableERC721Token(_token).burn(_tokenId);
            data = abi.encodeWithSelector(
                this.handleNativeNFT.selector,
                nativeTokenAddress(_token),
                _receiver,
                _tokenId
            );
        }

        if (isNativeToken) {
            _setMediatorOwns(_token, _tokenId, true);
        }

        bytes32 _messageId =
            bridgeContract().requireToPassMessage(mediatorContractOnOtherSide(), data, requestGasLimit());

        _recordBridgeOperation(!isKnownToken, _messageId, _token, _from, _tokenId);
    }

    /**
     * @dev Unlock/Mint back the bridged token that was bridged to the other network but failed.
     * @param _messageId id of the failed message.
     * @param _token address that bridged token contract.
     * @param _recipient address that will receive the tokens.
     * @param _tokenId unique id of the bridged token.
     */
    function executeActionOnFixedTokens(
        bytes32 _messageId,
        address _token,
        address _recipient,
        uint256 _tokenId
    ) internal override {
        bytes32 registrationMessageId = tokenRegistrationMessageId(_token);
        if (_messageId == registrationMessageId) {
            delete uintStorage[keccak256(abi.encodePacked("dailyLimit", _token))];
            delete uintStorage[keccak256(abi.encodePacked("executionDailyLimit", _token))];
            _setTokenRegistrationMessageId(_token, bytes32(0));
        }

        _releaseToken(_token, registrationMessageId != bytes32(0), _recipient, _tokenId);
    }

    /**
     * @dev Handles the bridged token that came from the other side of the bridge.
     * Checks that the operation is inside the execution limits and invokes the Mint or Unlock accordingly.
     * @param _token token contract address on this side of the bridge.
     * @param _isNative true, if given token is native to this chain and Unlock should be used.
     * @param _recipient address that will receive the tokens.
     * @param _tokenId unique id of the bridged token.
     */
    function _handleTokens(
        address _token,
        bool _isNative,
        address _recipient,
        uint256 _tokenId
    ) internal {
        require(withinExecutionLimit(_token));
        addTotalExecutedPerDay(_token);

        _releaseToken(_token, _isNative, _recipient, _tokenId);

        emit TokensBridged(_token, _recipient, _tokenId, messageId());
    }

    /**
     * Internal function for unlocking/minting some specific ERC721 token.
     * @param _token address of the token contract.
     * @param _isNative true, if the token contract is native w.r.t to the bridge.
     * @param _recipient address of the tokens receiver.
     * @param _tokenId unique id of the bridged token.
     */
    function _releaseToken(
        address _token,
        bool _isNative,
        address _recipient,
        uint256 _tokenId
    ) internal {
        if (_isNative) {
            _setMediatorOwns(_token, _tokenId, false);
            IERC721(_token).transferFrom(address(this), _recipient, _tokenId);
        } else {
            IBurnableMintableERC721Token(_token).mint(_recipient, _tokenId);
        }
    }

    /**
     * @dev Internal function for recording bridge operation for further usage.
     * Recorded information is used for fixing failed requests on the other side.
     * @param _register true, if native token is bridged for the first time.
     * @param _messageId id of the sent message.
     * @param _token bridged token address.
     * @param _sender address of the tokens sender.
     * @param _tokenId unique id of the bridged token.
     */
    function _recordBridgeOperation(
        bool _register,
        bytes32 _messageId,
        address _token,
        address _sender,
        uint256 _tokenId
    ) internal {
        require(withinLimit(_token));
        addTotalSpentPerDay(_token);

        setMessageToken(_messageId, _token);
        setMessageRecipient(_messageId, _sender);
        setMessageValue(_messageId, _tokenId);

        if (_register) {
            _setTokenRegistrationMessageId(_token, _messageId);
        }

        emit TokensBridgingInitiated(_token, _sender, _tokenId, _messageId);
    }

    /**
     * @dev Internal function for initializing newly bridged token related information.
     * @param _token address of the token contract.
     */
    function _initToken(address _token) internal {
        _setDailyLimit(_token, dailyLimit(address(0)));
        _setExecutionDailyLimit(_token, executionDailyLimit(address(0)));
    }

    function _transformName(string memory _name) internal pure virtual returns (string memory);
}
