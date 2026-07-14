# Web Wallet

Web Wallet website.

## TOC

- [Web Wallet](#web-wallet)
  - [TOC](#toc)
  - [Build system and dev environment](#build-system-and-dev-environment)
  - [Environment variables](#environment-variables)
    - [NPM scripts](#npm-scripts)
  - [Running a local Rusk node](#running-a-local-rusk-node)

## Build system and dev environment

The build system assumes that you have at least Node.js v24.x installed. The LTS version is 24.13.0 at the time of writing.

All terminal commands assume that you are positioned in root folder of the repository.
Run `npm install` from the root folder to get the necessary dependencies.

As the application uses the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), in development mode [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl) is used to create a self-signed certificate to run the application in HTTPS. Being the certificate self-signed you need to create an exception in the browser to allow it to use the certificate.

The staging environment is at https://web-wallet-staging-oxs3z.ondigitalocean.app/

## Environment variables

The `dusk-wallet-js` library uses some [environment variables](https://github.com/dusk-network/dusk-wallet-js/blob/main/.env).

The application defines these variables by reading a local `.env` file containing the same variables used in the `dusk-wallet-js`, with the addition of the `VITE_` prefix.

N.B. the current `0.1.2` version of the library has no option to pick the network and uses the `LOCAL_NODE` only. The current testnet address is set in that variable in the example below:

```
VITE_BASE_PATH="" # can be empty string, must start with a slash otherwise, must not end with a slash
VITE_BRIDGE_CONTRACT_ID=""
VITE_EVM_BRIDGE_CONTRACT_ADDRESS=""
VITE_EVM_BRIDGE_CONTRACT_BLOCK_CREATED=
VITE_EVM_BRIDGE_BLOCK_EXPLORER_NAME="Dusk EVM Explorer"
VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL=""
VITE_EVM_BRIDGE_RPC_URL=""
VITE_EVM_CHAIN_ID=745
VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID=""
VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL="/drivers/optimism_portal_dd_opt.wasm"
VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID=""
VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL="/drivers/dispute_game_factory_dd_opt.wasm"
VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH=64
VITE_FEATURE_ALLOCATE=true
VITE_FEATURE_BRIDGE=true
VITE_FEATURE_MIGRATE=true
VITE_FEATURE_STAKE=true
VITE_FEATURE_TRANSFER=true
VITE_FEATURE_TRANSACTION_HISTORY=true
VITE_GAS_LIMIT_DEFAULT=100000000
VITE_GAS_LIMIT_LOWER=10000000
VITE_GAS_LIMIT_UPPER=1000000000
VITE_GAS_PRICE_DEFAULT=1
VITE_GAS_PRICE_LOWER=1
VITE_SYNC_INTERVAL=300000
VITE_MODE_MAINTENANCE=false
VITE_REOWN_PROJECT_ID="" # the ID of the EVM project (as on Reown Cloud)
VITE_NODE_URL="" # connect to a specific node
```

For the DuskEVM bridge, `VITE_BRIDGE_CONTRACT_ID` is the Dusk L1
`L1StandardBridge` contract id used for DuskDS -> DuskEVM deposits.
`VITE_EVM_BRIDGE_CONTRACT_ADDRESS` is the DuskEVM L2 `L2StandardBridge`
address used for DuskEVM -> DuskDS withdrawals. The current wallet bridge
uses the pinned `@dusk/evm-sdk` beta for versioned Dusk asset-recipient
metadata, L2 withdrawal calldata, `MessagePassed` verification, and L1 Portal
argument serialization. Generic Dusk delivery envelopes for arbitrary L2 ->
L1 contract messages are a separate application surface and are not exposed
by the bridge UI.

Withdrawal finalization uses the existing Dusk-native wallet path on L1.
Reown/Wagmi is only used for the DuskEVM/L2 side. The wallet uses
`VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID` and its data-driver URL to call
`proveWithdrawalTransaction`, `finalizeWithdrawalTransaction`, and withdrawal
status getters through w3sper. It uses
`VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID` and its data-driver URL to find a
dispute game/output proposal that covers the L2 withdrawal block. The respected
dispute game type is read from the portal at runtime. This flow requires Rusk
1.7.1 or later so read-only contract queries execute at the current chain tip
and can evaluate proof maturity correctly.
The data-driver URLs must point to browser-loadable Forge data-driver WASM
artifacts for the deployed contracts; they are not the deployed contract WASM
artifacts themselves. These `VITE_*` values are public build-time browser
configuration and must not be derived from user input. Data-driver URLs may be
relative/root-relative asset paths or `http(s)` URLs. If the URL variables are
unset or empty, the wallet uses the bundled `/drivers/optimism_portal_dd_opt.wasm`
and `/drivers/dispute_game_factory_dd_opt.wasm` artifacts.

To run a local node different steps are needed, so please read the [related section](#running-a-local-rusk-node).

## NPM scripts

- `npm run build` generates the production build
- `npm run checks` runs all checks (lint, typecheck and test)
- `npm run dev` generates the development build and starts the dev server
- `npm run dev:host` generates the development build, starts the dev server and exposes it to the local network
- `npm run lint`: performs the linting checks
- `npm run lint:fix`: runs ESLint with the `--fix` flag to fix formatting errors
- `npm run preview` previews the production build
- `npm test` runs the test suite
- `npm run test:coverage` runs the test suite and generates the code coverage report in the `coverage` folder
- `npm run test:watch` runs the test suite in watch mode
- `npm run typecheck` runs the type checker
- `npm run typecheck:watch` runs the type checker in watch mode

## Running a local Rusk node

The DuskEVM withdrawal flow requires Rusk 1.7.1 or later. To run a local node,
follow the instructions outlined in the [Rusk's readme](https://github.com/dusk-network/rusk).
