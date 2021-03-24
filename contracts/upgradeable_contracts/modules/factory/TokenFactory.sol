pragma solidity 0.7.5;

import "./TokenProxy.sol";
import "../OmnibridgeModule.sol";

/**
 * @title TokenFactory
 * @dev Factory contract for deployment of new TokenProxy contracts.
 */
contract TokenFactory is OmnibridgeModule {
    address public tokenImage;

    /**
     * @dev Initializes this contract
     * @param _mediator address of the mediator contract used together with this token factory.
     * @param _tokenImage address of the token image contract that should be used for creation of new tokens.
     */
    constructor(IOwnable _mediator, address _tokenImage) OmnibridgeModule(_mediator) {
        tokenImage = _tokenImage;
    }

    /**
     * @dev Updates the address of the used token image contract.
     * Only owner can call this method.
     * @param _tokenImage address of the new token image used for further deployments.
     */
    function setTokenImage(address _tokenImage) external onlyOwner {
        require(Address.isContract(_tokenImage));
        tokenImage = _tokenImage;
    }

    /**
     * @dev Deploys a new TokenProxy contract, using saved token image contract as a template.
     * @param _name deployed token name.
     * @param _symbol deployed token symbol.
     * @param _decimals deployed token decimals.
     * @param _chainId chain id of the current environment.
     * @return address of a newly created contract.
     */
    function deploy(
        string calldata _name,
        string calldata _symbol,
        uint8 _decimals,
        uint256 _chainId
    ) external returns (address) {
        return address(new TokenProxy(tokenImage, _name, _symbol, _decimals, _chainId, msg.sender));
    }
}
