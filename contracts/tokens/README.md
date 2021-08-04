This directory contains a set of ERC20/ERC677/ERC2612 token contracts used together with Omnibridge as a template for bridged contracts implementation.

These contracts are intended to be used only under a proxy pattern via the `TokenProxy` contract.
Therefore, there are no constructors for these contract.
All contracts are required to share the same storage layout described in `TokenStorageLayout`.

## Contracts
* `TokenStorageLayout.sol` - Common storage layout for all token contracts. Copied from old version of token contracts and `TokenProxy` contract.
* `openzeppelin/ERC20.sol` - Ported version of `@openzeppelin/contracts/token/ERC20/ERC20.sol` with different storage layout and deleted constructor.
* `openzeppelin/OwnableToken.sol` - Ported version of `@openzeppelin/contracts/access/Ownable.sol` with different storage layout, deleted constructor, deleted `renounceOwnership()` method.
* `ERC677.sol` - Adds `transferAndCall` method described in ERC677 standard.
* `BridgedToken.sol` - Adds bridge-related methods and access modifiers, so that the token contract can be controlled by the bridge.
* `PermittableToken.sol` - Adds two versions of `permit` method. One is from EIP2612. Second is the legacy version `permit` taken from Dai/Stake token. 
* `OmnibridgeTokenImage.sol` - Combination of the above contracts. This contract is used as an implementation template for all bridged tokens in the Omnibridge.
