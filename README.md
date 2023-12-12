# Web Wallet

Web Wallet website.

## TOC

- [Web Wallet](#web-wallet)
    - [TOC](#toc)
    - [Build system and dev environment](#build-system-and-dev-environment)
	- [Environment variables](#environment-variables)
    - [NPM scripts](#npm-scripts)

## Build system and dev environment

The build system assumes that you have at least Node.js v18.x installed. The LTS version is 18.16.0 at the time of writing.

All terminal commands assume that you are positioned in root folder of the repository.
Run `npm install` from the root folder to get the necessary dependencies.

As the application uses the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), in development mode [`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl) is used to create a self-signed certificate to run the application in HTTPS. Being the certificate self-signed you need to create an exception in the browser to allow it to use the certificate.

The staging environment is at https://web-wallet-staging-oxs3z.ondigitalocean.app/

## Environment variables
The `dusk-wallet-js` library uses some [environment variables](https://github.com/dusk-network/dusk-wallet-js/blob/main/.env).

The application defines these variables by reading a local `.env` file containing the same variables used in the `dusk-wallet-js`, with the addition of the `VITE_` prefix.

N.B. the current `0.1.2` version of the library has no option to pick the network and uses the `LOCAL_NODE` only.

```
VITE_LOCAL_NODE="http://127.0.0.1:8080/"
VITE_MAINNET_NODE=""
VITE_RKYV_TREE_LEAF_SIZE=632
VITE_STAKE_CONTRACT="0200000000000000000000000000000000000000000000000000000000000000"
VITE_TESTNET_NODE=""
VITE_TRANSFER_CONTRACT="0100000000000000000000000000000000000000000000000000000000000000"
```

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
