pragma solidity 0.7.5;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../interfaces/IOwnable.sol";

/**
 * @title OmnibridgeModule
 * @dev Common functionality for Omnibridge extension non-upgradeable module.
 */
abstract contract OmnibridgeModule is IOwnable {
    IOwnable public mediator;

    /**
     * @dev Initializes this contract.
     * @param _mediator address of the Omnibridge mediator contract that is allowed to perform additional actions on the particular module.
     */
    constructor(IOwnable _mediator) {
        mediator = _mediator;
    }

    /**
     * @dev Throws if sender is not the owner of this contract.
     */
    modifier onlyOwner {
        require(msg.sender == owner());
        _;
    }

    /**
     * @dev Throws if sender is not the mediator.
     */
    modifier onlyMediator {
        require(msg.sender == address(mediator));
        _;
    }

    /**
     * Tells the contract owner address that is allowed to change configuration of this module.
     * @return address of the owner account.
     */
    function owner() public view override returns (address) {
        return mediator.owner();
    }
}
