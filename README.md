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

The build system assumes that you have at least Node.js v18.x installed. The LTS version is 18.16.0 at the time of writing.

All terminal commands assume that you are positioned in root folder of the repository.
Run `npm install` from the root folder to get the necessary dependencies.

As the application uses the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), in development mode [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl) is used to create a self-signed certificate to run the application in HTTPS. Being the certificate self-signed you need to create an exception in the browser to allow it to use the certificate.

The staging environment is at https://web-wallet-staging-oxs3z.ondigitalocean.app/

## Environment variables
The `dusk-wallet-js` library uses some [environment variables](https://github.com/dusk-network/dusk-wallet-js/blob/main/.env).

The application defines these variables by reading a local `.env` file containing the same variables used in the `dusk-wallet-js`, with the addition of the `VITE_` prefix.

N.B. the current `0.1.2` version of the library has no option to pick the network and uses the `LOCAL_NODE` only. The current testnet address is set in that variable in the example below:

```
VITE_CURRENT_NODE=${VITE_LOCAL_NODE}
VITE_CURRENT_PROVER_NODE=${VITE_LOCAL_NODE}
VITE_GAS_LIMIT_DEFAULT=20000000
VITE_GAS_LIMIT_LOWER=10000000
VITE_GAS_LIMIT_UPPER=1000000000
VITE_GAS_PRICE_DEFAULT=1
VITE_GAS_PRICE_LOWER=1
VITE_LOCAL_NODE="https://localhost:5173/rusk/"
VITE_MAINNET_NODE=""
VITE_RKYV_TREE_LEAF_SIZE=632
VITE_STAKE_CONTRACT="0200000000000000000000000000000000000000000000000000000000000000"
VITE_STAKING_ENABLED=true
VITE_TESTNET_NODE="https://nodes.dusk.network/"
VITE_TESTNET_PROVER_NODE="https://provers.dusk.network/"
VITE_TRANSFER_CONTRACT="0100000000000000000000000000000000000000000000000000000000000000"
VITE_TRANSFER_ENABLED=true
```

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
- `npm run test:coverage` runs the test suite and generate the code coverage report in the `coverage` folder
- `npm run test:watch` runs the test suite in watch mode
- `npm run typecheck` runs the type checker
- `npm run typecheck:watch` runs the type checker in watch mode

## Running a local Rusk node

To run a local node you should have [Docker](https://www.docker.com/) installed.

In a local folder on your computer create a `genesis.toml` file with the following content:

```toml
[acl.stake]
owners = [
    'oCqYsUMRqpRn2kSabH52Gt6FQCwH5JXj5MtRdYVtjMSJ73AFvdbPf98p3gz98fQwNy9ZBiDem6m9BivzURKFSKLYWP3N9JahSPZs9PnZ996P18rTGAjQTNFsxtbrKx79yWu',
]
allowlist = [
    'oCqYsUMRqpRn2kSabH52Gt6FQCwH5JXj5MtRdYVtjMSJ73AFvdbPf98p3gz98fQwNy9ZBiDem6m9BivzURKFSKLYWP3N9JahSPZs9PnZ996P18rTGAjQTNFsxtbrKx79yWu',
    'ocXXBAafr7xFqQTpC1vfdSYdHMXerbPCED2apyUVpLjkuycsizDxwA6b9D7UW91kG58PFKqm9U9NmY9VSwufUFL5rVRSnFSYxbiKK658TF6XjHsHGBzavFJcxAzjjBRM4eF'
]

[[balance]]
address = '4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG'
seed = 0xdead_beef
notes = [100_000_000_000_000]

[[stake]]
address = 'oCqYsUMRqpRn2kSabH52Gt6FQCwH5JXj5MtRdYVtjMSJ73AFvdbPf98p3gz98fQwNy9ZBiDem6m9BivzURKFSKLYWP3N9JahSPZs9PnZ996P18rTGAjQTNFsxtbrKx79yWu'
amount = 1_000_000_000_000
```

Open a terminal, go to the folder with the `genesis.toml` file and run:

```bash
docker run --name rusk -p 9000:9000/udp -p 8080:8080/tcp -v ./genesis.toml:/opt/rusk/state.toml dusknetwork/node:latest
```

This will download the image and run the node on `http://localhost:8080/`.

In your `.env` file edit the `VITE_LOCAL_NODE` variable as follows:

```
VITE_LOCAL_NODE="https://localhost:5173/rusk/"
```

The Vite dev server will act as a proxy, so the node will appear to the browser as running on HTTPS and on the same origin, without requiring CORS headers.

With the local node you can use the following mnemonic to test an account with some Dusk on it:

`auction tribe type torch domain caution lyrics mouse alert fabric snake ticket`
