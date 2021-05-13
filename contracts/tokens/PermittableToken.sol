pragma solidity 0.7.5;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./openzeppelin/ERC20.sol";

/**
 * @title PermittableToken
 * @dev The basic implementation of a permittable token. Supports both EIP2612 and permit() adopted from Stake token.
 */
contract PermittableToken is ERC20 {
    using SafeMath for uint256;

    string public constant version = "1";

    // bytes32 public constant PERMIT_TYPEHASH_LEGACY = keccak256("Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)");
    bytes32 public constant PERMIT_TYPEHASH_LEGACY = 0xea2aa0a1be11a07ed86d755c93467f4f82362b452371d1ba94d1715123511acb;
    // bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public constant PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;

    /**
     * @dev Tells the EIP712 domain separator.
     * @return EIP712 domain separator.
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    /**
     * @dev Tells the nonce for the given holder.
     * @param _owner address of the tokens holder.
     * @return valid nonce that should used in the next permit message.
     */
    function nonces(address _owner) external view returns (uint256) {
        return _nonces[_owner];
    }

    /**
     * @dev Tells the expiration timestamp for the unlimited approval.
     * @param _owner a
     */
    function expirations(address _owner, address _spender) external view returns (uint256) {
        return _expirations[_owner][_spender];
    }

    /** @dev Allows to spend holder's unlimited amount by the specified spender.
     * The function can be called by anyone, but requires having allowance parameters
     * signed by the holder according to EIP712.
     * @param _holder The holder's address.
     * @param _spender The spender's address.
     * @param _nonce The nonce taken from `nonces(_holder)` public getter.
     * @param _expiry The allowance expiration date (unix timestamp in UTC).
     * Can be zero for no expiration. Forced to zero if `_allowed` is `false`.
     * Note that timestamps are not precise, malicious miner/validator can manipulate them to some extend.
     * Assume that there can be a 900 seconds time delta between the desired timestamp and the actual expiration.
     * @param _allowed True to enable unlimited allowance for the spender by the holder. False to disable.
     * @param _v A final byte of signature (ECDSA component).
     * @param _r The first 32 bytes of signature (ECDSA component).
     * @param _s The second 32 bytes of signature (ECDSA component).
     */
    function permit(
        address _holder,
        address _spender,
        uint256 _nonce,
        uint256 _expiry,
        bool _allowed,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(_expiry == 0 || block.timestamp <= _expiry);

        bytes32 digest = _digest(abi.encode(PERMIT_TYPEHASH_LEGACY, _holder, _spender, _nonce, _expiry, _allowed));

        require(_holder == _recover(digest, _v, _r, _s));
        require(_nonce == _nonces[_holder]++);

        uint256 amount = _allowed ? uint256(-1) : 0;

        _expirations[_holder][_spender] = _allowed ? _expiry : 0;

        _approve(_holder, _spender, amount);
    }

    /** @dev Allows to spend holder's unlimited amount by the specified spender.
     * The function can be called by anyone, but requires having allowance parameters
     * signed by the holder according to EIP712.
     * @param _holder The holder's address.
     * @param _spender The spender's address.
     * @param _value Allowance value to set as a result of the call.
     * @param _deadline The deadline timestamp to call the permit function. Must be a timestamp in the future.
     * Note that timestamps are not precise, malicious miner/validator can manipulate them to some extend.
     * Assume that there can be a 900 seconds time delta between the desired timestamp and the actual expiration.
     * @param _v A final byte of signature (ECDSA component).
     * @param _r The first 32 bytes of signature (ECDSA component).
     * @param _s The second 32 bytes of signature (ECDSA component).
     */
    function permit(
        address _holder,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(block.timestamp <= _deadline);

        uint256 nonce = _nonces[_holder]++;
        bytes32 digest = _digest(abi.encode(PERMIT_TYPEHASH, _holder, _spender, _value, nonce, _deadline));

        require(_holder == _recover(digest, _v, _r, _s));

        _approveAndResetExpirations(_holder, _spender, _value);
    }

    /**
     * @dev Uses previously given allowance to transfer tokens on behalf of a different user.
     * Works in a slightly different form than the generic transferFrom.
     * In case of an existing unlimited approval from the sender, allowance value is not being decreased.
     * @param _sender address from where to spend tokens.
     * @param _recipient tokens receiver address.
     * @param _amount amount of transferred tokens.
     * @return true, if operation succeeded.
     */
    function transferFrom(
        address _sender,
        address _recipient,
        uint256 _amount
    ) public virtual override returns (bool) {
        uint256 allowedAmount = _allowances[_sender][_msgSender()];

        if (allowedAmount == uint256(-1)) {
            // If allowance is unlimited by `permit`, `approve`, or `increaseAllowance`
            // function, don't adjust it. But the expiration date must be empty or in the future
            require(_expirations[_sender][_msgSender()] == 0 || _expirations[_sender][_msgSender()] >= block.timestamp);
        } else {
            // If allowance is limited, adjust it.
            // In this case `transferFrom` works like the generic
            _approve(_sender, _msgSender(), allowedAmount.sub(_amount, "ERC20: transfer amount exceeds allowance"));
        }

        _transfer(_sender, _recipient, _amount);

        return true;
    }

    /**
     * @dev Approves the given address to spend tokens on behalf of the sender.
     * Resets expiration timestamp in case of unlimited approval.
     * @param _to address allowed to spend tokens.
     * @param _value amount of given allowance.
     * @return true, if operation succeeded.
     */
    function approve(address _to, uint256 _value) public virtual override returns (bool) {
        _approveAndResetExpirations(_msgSender(), _to, _value);
        return true;
    }

    /**
     * @dev Atomically increases the allowance granted to spender by the caller.
     * Resets expiration timestamp in case of unlimited approval.
     * @param _to address allowed to spend tokens.
     * @param _addedValue amount of allowance increase.
     * @return true, if operation succeeded.
     */
    function increaseAllowance(address _to, uint256 _addedValue) public virtual override returns (bool) {
        _approveAndResetExpirations(_msgSender(), _to, _allowances[_msgSender()][_to].add(_addedValue));
        return true;
    }

    /**
     * @dev Sets a new allowance value for the given owner and spender addresses.
     * Resets expiration timestamp in case of unlimited approval.
     * @param _owner address tokens holder.
     * @param _spender address of tokens spender.
     * @param _amount amount of approved tokens.
     */
    function _approveAndResetExpirations(
        address _owner,
        address _spender,
        uint256 _amount
    ) internal {
        _approve(_owner, _spender, _amount);

        // it is not necessary to reset _expirations in other cases, since it is only used together with infinite allowance
        if (_amount == uint256(-1)) {
            delete _expirations[_owner][_spender];
        }
    }

    /**
     * @dev Calculates the message digest for encoded EIP712 typed struct.
     * @param _typedStruct encoded payload.
     */
    function _digest(bytes memory _typedStruct) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, keccak256(_typedStruct)));
    }

    /**
     * @dev Derives the signer address for the given message digest and ECDSA signature params.
     * @param _digest signed message digest.
     * @param _v a final byte of signature (ECDSA component).
     * @param _r the first 32 bytes of the signature (ECDSA component).
     * @param _s the second 32 bytes of the signature (ECDSA component).
     */
    function _recover(
        bytes32 _digest,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal pure returns (address) {
        require(_v == 27 || _v == 28, "ECDSA: invalid signature 'v' value");
        require(
            uint256(_s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "ECDSA: invalid signature 's' value"
        );

        address signer = ecrecover(_digest, _v, _r, _s);
        require(signer != address(0), "ECDSA: invalid signature");

        return signer;
    }
}
