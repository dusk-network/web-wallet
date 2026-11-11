# Web Wallet

Web Wallet website.

## TOC

- [Web Wallet](#web-wallet)
  - [TOC](#toc)
  - [Build system and dev environment](#build-system-and-dev-environment)
  - [Browser support](#browser-support)
  - [Fingerprint or face unlock](#fingerprint-or-face-unlock)
  - [Environment variables](#environment-variables)
    - [NPM scripts](#npm-scripts)
  - [Deploying](#deploying)
  - [Verify a deployment](#verify-a-deployment)
  - [Running a local Rusk node](#running-a-local-rusk-node)

## Build system and dev environment

The build system assumes that you have at least Node.js v24.x installed. The LTS version is 24.13.0 at the time of writing.

All terminal commands assume that you are positioned in root folder of the repository.
Run `npm install` from the root folder to get the necessary dependencies.

As the application uses the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), in development mode [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl) is used to create a self-signed certificate to run the application in HTTPS. Being the certificate self-signed you need to create an exception in the browser to allow it to use the certificate.

## Browser support

Web Wallet supports browser releases from the previous two years. The current
minimum versions are Chrome 129, Edge 129, Firefox 130, and Safari 18. These
versions must be reviewed with each major Web Wallet release.

The Vite build target enforces the corresponding JavaScript and CSS syntax
level. It does not polyfill browser APIs or built-in methods.

## Fingerprint or face unlock

Settings can turn on an unlock by passkey: WebAuthn on this origin, with its PRF
extension, on browsers and platform authenticators that have it, and off by
default. It takes the password to turn on. The password stays the root: it opens
the vault as ever, and losing the passkey loses nothing.

What's stored, in `localStorage` under `<app>-login-passkey`: the credential's
ID, its transports, a random PRF salt, and for each key of the vault its PBKDF2
salt and iterations, an IV, and the key itself as AES-256-GCM keeps it under a key
derived (HKDF-SHA-256) from the passkey's PRF output, bound to the credential and
the salt. The password is stored nowhere, in any form, and neither is any phrase
but in the vault.

Someone with the browser's storage, without the passkey, has what they'd have
without this: the vault, to guess the password of. What wraps the keys comes only
from the authenticator, for this origin, once it has verified the person, and
nothing a person knows goes into it. Anything that runs on this origin while the
person is there can ask for the same prompt, as it can read a password typed; and
platforms take their screen lock for verifying the person, so whoever knows a
phone's PIN passes, as they would to anything else on it.

A new password, removing a wallet, Reset and a new setup drop the record, and the
browser is told the passkey opens nothing where it listens
(`signalUnknownCredential`); left in a password manager, it opens nothing. Asking
for the password on big sends, and every change of the vault, still take the
password.

## Environment variables

The `dusk-wallet-js` library uses some [environment variables](https://github.com/dusk-network/dusk-wallet-js/blob/main/.env).

The application defines these variables by reading a local `.env` file containing the same variables used in the `dusk-wallet-js`, with the addition of the `VITE_` prefix.

N.B. the current `0.1.2` version of the library has no option to pick the network and uses the `LOCAL_NODE` only. The current testnet address is set in that variable in the example below:

```
VITE_BASE_PATH="" # can be empty string, must start with a slash otherwise, must not end with a slash
VITE_EVM_DEPOSIT_DELAY_THRESHOLD_MS=300000
VITE_EVM_DEPOSIT_STALL_THRESHOLD_MS=1800000
VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH=64
VITE_FEATURE_ALLOCATE=true
VITE_FEATURE_BRIDGE=true
VITE_FEATURE_MIGRATE=true
VITE_FEATURE_STAKE=true
VITE_FEATURE_TRANSFER=true
VITE_FEATURE_TRANSACTION_HISTORY=true
VITE_GAS_LIMIT_UPPER=1000000000
VITE_GAS_PRICE_DEFAULT=1
VITE_GAS_PRICE_LOWER=1
VITE_SYNC_INTERVAL=300000
VITE_MODE_MAINTENANCE=false
VITE_REOWN_PROJECT_ID="" # the ID of the EVM project (as on Reown Cloud)
VITE_NODE_URL="" # connect to a specific node
```

The wallet finds its network by the chain ID the node gives in
`/on/node/info`, never by the node's address, and takes the network's
contracts, Sozu's hub, DuskEVM, the bridge routes, the contract labels and the
recipient blocklist from its file in `@dusk-network/networks`. For local work,
these variables set DuskEVM's values instead: `VITE_BRIDGE_CONTRACT_ID`,
`VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID`,
`VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID`,
`VITE_EVM_ANCHOR_STATE_REGISTRY_CONTRACT_ID`, their `*_DATA_DRIVER_URL`s,
`VITE_EVM_CHAIN_ID`, `VITE_EVM_BRIDGE_RPC_URL`, `VITE_EVM_L1_BRIDGE_RPC_URL`,
`VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL` and `VITE_EVM_BRIDGE_CONTRACT_ADDRESS`.
On mainnet they count for nothing until its file has DuskEVM's routes, so a
wallet is never offered a chain that isn't live.

The transaction history is on unless `VITE_FEATURE_TRANSACTION_HISTORY` is
`false`. It reads the public account's history from the node's archive
(`moonlightHistory` over GraphQL) by block height, and the shielded history
from the notes the wallet has synced. Both are kept in the browser, so a
refresh only asks for what is new, and are cleared when the wallet is reset.

Each operation has its own default gas limit and minimum, defined in
`src/lib/contracts/gasDefaults.js`. `VITE_GAS_LIMIT_UPPER` caps the gas limit
for all of them.

For the DuskEVM bridge, the network file's `l1_standard_bridge` (or
`VITE_BRIDGE_CONTRACT_ID`) is the Dusk L1 `L1StandardBridge` contract id used
for DuskDS -> DuskEVM deposits, and its `l2StandardBridge` predeploy (or
`VITE_EVM_BRIDGE_CONTRACT_ADDRESS`) the DuskEVM L2 `L2StandardBridge` address
used for DuskEVM -> DuskDS withdrawals. The current wallet bridge
uses the pinned `@dusk/evm-sdk` beta for versioned Dusk asset-recipient
metadata, L2 withdrawal calldata, `MessagePassed` verification, and L1 Portal
argument serialization. The DuskEVM adapter's Ethereum-compatible L1 RPC is
at `/l1` on DuskEVM's RPC host, unless `VITE_EVM_L1_BRIDGE_RPC_URL` points
elsewhere. The wallet uses it only for deposits: to
confirm a deposit's DuskDS receipt, derive the OP deposit transaction, and
track delivery on `VITE_EVM_BRIDGE_RPC_URL`. Withdrawals are read on Dusk
itself. `VITE_EVM_DEPOSIT_DELAY_THRESHOLD_MS` controls when
an in-transit deposit is labelled delayed; it defaults to five minutes. Generic
Dusk delivery envelopes for arbitrary L2 -> L1 contract messages are a
separate application surface and are not exposed by the bridge UI.

DuskEVM's explorer, or `VITE_EVM_BRIDGE_BLOCK_EXPLORER_URL`, must be a
Blockscout-compatible explorer for the DuskEVM network. Withdrawal activity uses its v2
address-transactions and transaction-detail APIs, including the
`op_withdrawals` data returned by Blockscout's Optimism module, and its list of
all withdrawals to find, by their nonces, the ones the account proved or
claimed on Dusk: Bridge › Activity lists those without an EVM wallet
connected. If the explorer is temporarily unavailable, the wallet retains and
displays a bounded local history of withdrawals initiated in that browser.

Withdrawal finalization uses the existing Dusk-native wallet path on L1.
Reown/Wagmi is only used for the DuskEVM/L2 side. The wallet uses the
OptimismPortal contract and its data driver to call
`proveWithdrawalTransaction`, `finalizeWithdrawalTransaction`, and withdrawal
status getters through w3sper. It uses the DisputeGameFactory contract and
its data driver to find a
dispute game/output proposal that covers the L2 withdrawal block. The respected
dispute game type is read from the portal at runtime. With the anchor state
registry the portal asks whether a game is proper and respected, a proof goes
against a
covering game that has already resolved and passes those checks, so its claim
date is exact; otherwise against the newest covering game.
`VITE_EVM_ANCHOR_STATE_REGISTRY_CONTRACT_ID=none` leaves it out. This flow requires Rusk
1.7.1 or later so read-only contract queries execute at the current chain tip
and can evaluate proof maturity correctly.
The data-driver URLs must point to browser-loadable Forge data-driver WASM
artifacts for the deployed contracts; they are not the deployed contract WASM
artifacts themselves. These `VITE_*` values are public build-time browser
configuration and must not be derived from user input. Data-driver URLs may be
relative/root-relative asset paths or `http(s)` URLs. If the URL variables are
unset or empty, the wallet uses the drivers the network's file names, bundled
under `/drivers/`.

A withdrawal can be claimed from the later of its proof plus the Portal's
proof maturity delay, and its dispute game's resolution plus the game's
finality delay. History, a withdrawal's details and Bridge › Activity show that
date: exact once the game has resolved, and before that the earliest it can be
(the game resolves once its `maxClockDuration` has run out), as "about". A game
unresolved more than an hour past that is late: "Waiting for DuskEVM to settle
this proof. Claim from … at the soonest." The Portal's reads and the game's, on
the hub the factory names for it (`createdAtForGame`, `resolvedAtForGame`,
`statusForGame`, `maxClockDuration`), go through Multicall for Dusk, one query
once the game's hub is known. The times are the contracts' own: the deployed
testnet contracts count Dusk block height × 10, which the latest block converts
to a date; others count block time, a second later for their strict
comparisons. A proof goes against a game that covers the withdrawal and has
already resolved, where there is one, so its claim date is exact when it's
made; otherwise against the newest that covers it.

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

## Deploying

Testnet runs on Cloudflare (`wrangler.jsonc`), at
`https://apps.testnet.dusk.network/wallet/`. Its address mustn't change:
browsers keep each wallet by its origin. The build's files are served at
`/wallet/` as built, with the headers in `static/_headers`, and
`deploy/worker.js` answers what no file does: an address under `/wallet/` that
no page has opens the wallet, which says what's there; a file under
`/wallet/_app/` that isn't there is a 404; and `/explorer` goes on to the
explorer's own domain.

The Deploy workflow does it: a push to a `deploy/web-wallet-testnet*` branch
goes to testnet, built with the site's settings in `deployments.json`. That
branch is `main` with what only testnet takes, as a network's file. Its
Cloudflare token is a secret of the `cloudflare` environment, which only those
branches can use.

Mainnet and devnet stay on DigitalOcean for now; mainnet moves with the
wallet's v2. The workflow deploys a `web-wallet-v*` tag to mainnet only once
the `DEPLOY_MAINNET` repository variable is `true` and the `cloudflare`
environment takes those tags.

## Verify a deployment

The same commit, built with the same settings, makes the same files. Each build
writes `build/build-manifest.json`, served beside the app: the version, the
commit built, the mode and the `VITE_` settings it was built with, Node's and
npm's versions, and every file's SHA-256. The footer's version on the setup
page links to it. Vite builds every `VITE_` setting into the code, so none of
them is a secret. `deployments.json` lists each deployment's settings.
Testnet is built with its entry there; mainnet and devnet are still built with
their DigitalOcean spec, so change theirs there with it.

To rebuild what a site serves and compare, from a clone of this repository:

```bash
node scripts/verify-build.js https://apps.dusk.network/wallet/
```

The script builds the manifest's commit in a new worktree, with `npm ci` and
`npm run build`, and checks every file, and every page at the addresses
browsers open it by, against the rebuild and the manifest. It trusts nothing
the site says: it builds only a commit on a branch or tag of your clone, with
the settings `deployments.json` lists for the site, and refuses a manifest a
build wouldn't write. A site built before builds were reproducible has no
manifest, and can't be checked. Cloudflare reads `_headers` and doesn't serve
it, so that file is checked against the manifest alone.

## Running a local Rusk node

The DuskEVM withdrawal flow requires Rusk 1.7.1 or later. To run a local node,
follow the instructions outlined in the [Rusk's readme](https://github.com/dusk-network/rusk).
