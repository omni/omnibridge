# End-to-end testing

This directory contains all required scripts for testing Omnibridge extension contract in near-to-live environment.

Testing can be run in 2 modes, using local environment and using public testnets (Sokol, Kovan).

## Local testing

From the repository root, run the following command:

```bash
yarn e2e-tests:local # same as ./e2e-tests/run-tests.sh local
```

This will do the following:
* Start 2 Ganache instances for emulating Home and Foreign chains
* Deploy AMB contracts in both chains (using `poanetwork/tokenbridge-contracts` docker image)
* Deploy Omnibridge contract in both chains
* Start the AMB oracle (using `poanetwork/tokenbridge-oracle` docker image)
* Run the test scripts for executing different usage scenarios 

## Public testing

The following prerequisites are needed for running tests on public testnets:
* AMB contract are deployed
* Omnibridge contract are deployed
* Sufficient number of oracles are running
* Prefunded accounts derived from the same private key exists in both chains
* File `./e2e-tests/.env` is created and filled (look at the template at `./e2e-tests/.env.example`)

```bash
yarn e2e-tests:public # same as ./e2e-tests/run-tests.sh
```

