pragma solidity 0.7.5;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./openzeppelin/ERC20.sol";

/**
 * @title PermittableToken
 * @dev The basic implementation of an permittable token
 */
contract PermittableToken is ERC20 {
    using SafeMath for uint256;

    string public constant version = "1";

    // bytes32 public constant PERMIT_TYPEHASH_LEGACY = keccak256("Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)");
    bytes32 public constant PERMIT_TYPEHASH_LEGACY = 0xea2aa0a1be11a07ed86d755c93467f4f82362b452371d1ba94d1715123511acb;
    // bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 public constant PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    function nonces(address owner) external view returns (uint256) {
        return _nonces[owner];
    }

    function expirations(address _owner, address _spender) external view returns (uint256) {
        return _expirations[_owner][_spender];
    }

    /// @dev Allows to spend holder's unlimited amount by the specified spender.
    /// The function can be called by anyone, but requires having allowance parameters
    /// signed by the holder according to EIP712.
    /// @param _holder The holder's address.
    /// @param _spender The spender's address.
    /// @param _nonce The nonce taken from `nonces(_holder)` public getter.
    /// @param _expiry The allowance expiration date (unix timestamp in UTC).
    /// Can be zero for no expiration. Forced to zero if `_allowed` is `false`.
    /// Note that timestamps are not precise, malicious miner/validator can manipulate them to some extend.
    /// Assume that there can be a 900 seconds time delta between the desired timestamp and the actual expiration.
    /// @param _allowed True to enable unlimited allowance for the spender by the holder. False to disable.
    /// @param _v A final byte of signature (ECDSA component).
    /// @param _r The first 32 bytes of signature (ECDSA component).
    /// @param _s The second 32 bytes of signature (ECDSA component).
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

    /// @dev Sets `value` as allowance of `spender` account over `owner` account's WETH10 token, given `owner` account's signed approval.
    /// Emits {Approval} event.
    /// Requirements:
    ///   - `deadline` must be timestamp in future.
    ///   - `v`, `r` and `s` must be valid `secp256k1` signature from `owner` account over EIP712-formatted function arguments.
    ///   - the signature must use `owner` account's current nonce (see {nonces}).
    ///   - the signer cannot be `address(0)` and must be `owner` account.
    /// For more information on signature format, see https://eips.ethereum.org/EIPS/eip-2612#specification[relevant EIP section].
    /// WETH10 token implementation adapted from https://github.com/albertocuestacanada/ERC20Permit/blob/master/contracts/ERC20Permit.sol.
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

    /// @dev transferFrom in this contract works in a slightly different form than the generic
    /// transferFrom function. This contract allows for "unlimited approval".
    /// Should the user approve an address for the maximum uint256 value,
    /// then that address will have unlimited approval until told otherwise.
    /// @param _sender The address of the sender.
    /// @param _recipient The address of the recipient.
    /// @param _amount The value to transfer.
    /// @return Success status.
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

    /// @dev Approve the passed address to spend the specified amount of tokens on behalf of msg.sender.
    /// @param _to The address which will spend the funds.
    /// @param _value The amount of tokens to be spent.
    function approve(address _to, uint256 _value) public virtual override returns (bool) {
        _approveAndResetExpirations(_msgSender(), _to, _value);
        return true;
    }

    /// @dev Atomically increases the allowance granted to spender by the caller.
    /// @param _to The address which will spend the funds.
    /// @param _addedValue The amount of tokens to increase the allowance by.
    function increaseAllowance(address _to, uint256 _addedValue) public virtual override returns (bool) {
        _approveAndResetExpirations(_msgSender(), _to, _allowances[_msgSender()][_to].add(_addedValue));
        return true;
    }

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

    function _digest(bytes memory _typedStruct) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, keccak256(_typedStruct)));
    }

    function _recover(
        bytes32 digest,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) internal pure returns (address) {
        require(_v == 27 || _v == 28, "ECDSA: invalid signature 'v' value");
        require(
            uint256(_s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "ECDSA: invalid signature 's' value"
        );

        address signer = ecrecover(digest, _v, _r, _s);
        require(signer != address(0), "ECDSA: invalid signature");

        return signer;
    }
}
