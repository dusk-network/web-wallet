# Web Wallet

Web Wallet website.

## TOC

- [Web Wallet](#web-wallet)
    - [TOC](#toc)
    - [Build system and dev environment](#build-system-and-dev-environment)
    - [NPM scripts](#npm-scripts)

## Build system and dev environment

The build system assumes that you have at least Node.js v18.x installed. The LTS version is 18.16.0 at the time of writing.
All terminal commands assume that you are positioned in root folder of the repository.
Run `npm install` from the root folder to get the necessary dependencies.

## NPM scripts

-`npm run build` generates the production build
-`npm run checks` runs all checks (lint, typecheck and test)
-`npm run typecheck` runs the type checker
-`npm run typecheck:watch` runs the type checker in watch mode
-`npm run dev` generates the development build and starts the dev server
-`npm run lint`: performs the linting checks
-`npm run lint:fix`: runs ESLint with the `--fix` flag to fix formatting errors
-`npm run preview` previews the production build
-`npm test` runs the test suite
-`npm run test:coverage` runs the test suite and generate the code coverage report in the `coverage` folder
-`npm run test:watch` runs the test suite in watch mode
