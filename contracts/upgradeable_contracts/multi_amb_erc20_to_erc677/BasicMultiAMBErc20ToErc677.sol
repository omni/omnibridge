pragma solidity 0.7.5;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../Initializable.sol";
import "../Upgradeable.sol";
import "../Claimable.sol";
import "./components/bridged/BridgedTokensRegistry.sol";
import "./components/native/NativeTokensRegistry.sol";
import "./components/native/MediatorBalanceStorage.sol";
import "./components/common/TokensRelayer.sol";
import "./components/common/OmnibridgeInfo.sol";
import "./components/common/TokensBridgeLimits.sol";
import "./components/common/FailedMessagesProcessor.sol";
import "./modules/factory/TokenFactoryConnector.sol";
import "../../interfaces/IBurnableMintableERC677Token.sol";
import "../../libraries/TokenReader.sol";

/**
 * @title BasicMultiAMBErc20ToErc677
 * @dev Common functionality for universal multi-erc20-to-erc677 mediator intended to work on top of AMB bridge.
 */
abstract contract BasicMultiAMBErc20ToErc677 is
    Initializable,
    Upgradeable,
    Claimable,
    OmnibridgeInfo,
    TokensRelayer,
    FailedMessagesProcessor,
    BridgedTokensRegistry,
    NativeTokensRegistry,
    MediatorBalanceStorage,
    TokenFactoryConnector,
    TokensBridgeLimits
{
    using SafeERC20 for IERC677;
    using SafeMath for uint256;

    /**
     * @dev Handles the bridged tokens for the first time, includes deployment of new TokenProxy contract.
     * Checks that the value is inside the execution limits and invokes the Mint or Unlock accordingly.
     * @param _token address of the native ERC20/ERC677 token on the other side.
     * @param _name name of the native token, name suffix will be appended, if empty, symbol will be used instead.
     * @param _symbol symbol of the bridged token, if empty, name will be used instead.
     * @param _decimals decimals of the bridge foreign token.
     * @param _recipient address that will receive the tokens.
     * @param _value amount of tokens to be received.
     */
    function deployAndHandleBridgedTokens(
        address _token,
        string calldata _name,
        string calldata _symbol,
        uint8 _decimals,
        address _recipient,
        uint256 _value
    ) external onlyMediator {
        string memory name = _name;
        string memory symbol = _symbol;
        require(bytes(name).length > 0 || bytes(symbol).length > 0);
        if (bytes(name).length == 0) {
            name = symbol;
        } else if (bytes(symbol).length == 0) {
            symbol = name;
        }
        name = _transformName(name);
        address bridgedToken = tokenFactory().deploy(name, symbol, _decimals, bridgeContract().sourceChainId());
        _setTokenAddressPair(_token, bridgedToken);
        _initToken(bridgedToken, _decimals);

        _handleTokens(bridgedToken, false, _recipient, _value);
    }

    /**
     * @dev Handles the bridged tokens for the already registered token pair.
     * Checks that the value is inside the execution limits and invokes the Mint or Unlock accordingly.
     * @param _token address of the native ERC20/ERC677 token on the other side.
     * @param _recipient address that will receive the tokens.
     * @param _value amount of tokens to be received.
     */
    function handleBridgedTokens(
        address _token,
        address _recipient,
        uint256 _value
    ) external onlyMediator {
        address token = bridgedTokenAddress(_token);

        require(isTokenRegistered(token));

        _handleTokens(token, false, _recipient, _value);
    }

    /**
     * @dev Handles the bridged tokens that are native to this chain.
     * Checks that the value is inside the execution limits and invokes the Mint or Unlock accordingly.
     * @param _token native ERC20 token.
     * @param _recipient address that will receive the tokens.
     * @param _value amount of tokens to be received.
     */
    function handleNativeTokens(
        address _token,
        address _recipient,
        uint256 _value
    ) external onlyMediator {
        require(isRegisteredAsNativeToken(_token));

        _handleTokens(_token, true, _recipient, _value);
    }

    /**
     * @dev Unlock back the amount of tokens that were bridged to the other network but failed.
     * @param _messageId id of the failed message.
     * @param _token address that bridged token contract.
     * @param _recipient address that will receive the tokens.
     * @param _value amount of tokens to be received.
     */
    function executeActionOnFixedTokens(
        bytes32 _messageId,
        address _token,
        address _recipient,
        uint256 _value
    ) internal override {
        bytes32 registrationMessageId = tokenRegistrationMessageId(_token);
        if (registrationMessageId != bytes32(0)) {
            IERC677(_token).safeTransfer(_recipient, _value);
            _setMediatorBalance(_token, mediatorBalance(_token).sub(_value));
            if (_messageId == registrationMessageId) {
                delete uintStorage[keccak256(abi.encodePacked("dailyLimit", _token))];
                delete uintStorage[keccak256(abi.encodePacked("maxPerTx", _token))];
                delete uintStorage[keccak256(abi.encodePacked("minPerTx", _token))];
                delete uintStorage[keccak256(abi.encodePacked("executionDailyLimit", _token))];
                delete uintStorage[keccak256(abi.encodePacked("executionMaxPerTx", _token))];
                _setTokenRegistrationMessageId(_token, bytes32(0));
            }
        } else {
            IBurnableMintableERC677Token(_token).mint(_recipient, _value);
        }
    }

    /**
     * @dev Allows to send to the other network the amount of locked tokens that can be forced into the contract
     * without the invocation of the required methods. (e. g. regular transfer without a call to onTokenTransfer)
     * @param _token address of the token contract.
     * @param _receiver the address that will receive the tokens on the other network.
     */
    function fixMediatorBalance(address _token, address _receiver)
        external
        onlyIfUpgradeabilityOwner
        validAddress(_receiver)
    {
        require(isRegisteredAsNativeToken(_token));
        uint256 balance = IERC677(_token).balanceOf(address(this));
        uint256 expectedBalance = mediatorBalance(_token);
        require(balance > expectedBalance);
        uint256 diff = balance - expectedBalance;
        uint256 available = maxAvailablePerTx(_token);
        require(available > 0);
        if (diff > available) {
            diff = available;
        }
        addTotalSpentPerDay(_token, getCurrentDay(), diff);

        bytes memory data = abi.encodeWithSelector(this.handleBridgedTokens.selector, _token, _receiver, diff);

        bytes32 _messageId =
            bridgeContract().requireToPassMessage(mediatorContractOnOtherSide(), data, requestGasLimit());
        _recordBridgeOperation(false, _messageId, _token, _receiver, diff);
    }

    /**
     * @dev Claims stuck tokens. Only unsupported tokens can be claimed.
     * When dealing with already supported tokens, fixMediatorBalance can be used instead.
     * @param _token address of claimed token, address(0) for native
     * @param _to address of tokens receiver
     */
    function claimTokens(address _token, address _to) external onlyIfUpgradeabilityOwner {
        // Only unregistered tokens and native coins are allowed to be claimed with the use of this function
        require(_token == address(0) || !isTokenRegistered(_token));
        claimValues(_token, _to);
    }

    /**
     * @dev Internal function for recording bridge operation for further usage.
     * Recorded information is used for fixing failed requests on the other side.
     * @param _register true, if native token is bridged for the first time.
     * @param _messageId id of the sent message.
     * @param _token bridged token address.
     * @param _sender address of the tokens sender.
     * @param _value bridged value.
     */
    function _recordBridgeOperation(
        bool _register,
        bytes32 _messageId,
        address _token,
        address _sender,
        uint256 _value
    ) internal {
        setMessageToken(_messageId, _token);
        setMessageRecipient(_messageId, _sender);
        setMessageValue(_messageId, _value);

        if (_register) {
            _setTokenRegistrationMessageId(_token, _messageId);
        }

        emit TokensBridgingInitiated(_token, _sender, _value, _messageId);
    }

    /**
     * @dev Constructs the message to be sent to the other side. Burns/locks bridged amount of tokens.
     * @param _isKnownToken true, if token was already bridged previously.
     * @param _isNativeToken true, if token is native to this side of the bridge.
     * @param _token bridged token address.
     * @param _receiver address of the tokens receiver on the other side.
     * @param _value bridged value.
     * @param _decimals token decimals parameter, required only if _isKnownToken is false.
     */
    function _prepareMessage(
        bool _isKnownToken,
        bool _isNativeToken,
        address _token,
        address _receiver,
        uint256 _value,
        uint8 _decimals
    ) internal returns (bytes memory) {
        // process already known token that is native w.r.t. current chain
        if (_isKnownToken && _isNativeToken) {
            _setMediatorBalance(_token, mediatorBalance(_token).add(_value));
            return abi.encodeWithSelector(this.handleBridgedTokens.selector, _token, _receiver, _value);
        }

        // process already known token that is bridged from other chain
        if (_isKnownToken) {
            IBurnableMintableERC677Token(_token).burn(_value);
            return
                abi.encodeWithSelector(this.handleNativeTokens.selector, nativeTokenAddress(_token), _receiver, _value);
        }

        // process token that was not previously seen
        string memory name = TokenReader.readName(_token);
        string memory symbol = TokenReader.readSymbol(_token);

        require(bytes(name).length > 0 || bytes(symbol).length > 0);

        _setMediatorBalance(_token, _value);
        return
            abi.encodeWithSelector(
                this.deployAndHandleBridgedTokens.selector,
                _token,
                name,
                symbol,
                _decimals,
                _receiver,
                _value
            );
    }

    /**
     * @dev Internal function for initializing newly bridged token related information.
     * @param _token address of the token contract.
     * @param _decimals token decimals parameter.
     */
    function _initToken(address _token, uint8 _decimals) internal virtual {
        _initializeTokenBridgeLimits(_token, _decimals);
    }

    function _handleTokens(
        address _token,
        bool _isNative,
        address _recipient,
        uint256 _value
    ) internal virtual;

    function _transformName(string memory _name) internal pure virtual returns (string memory);
}
