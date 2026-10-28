/**
 * Default gas limit and client-side minimum for each operation, in gas units.
 * The Dusk Wallet extension uses the same numbers for the operations both
 * wallets have, but sends liquid staking with its limit for any contract call.
 *
 * Only the gas a transaction uses is charged, but a failed transaction,
 * including one that runs out of gas, is charged its whole limit. On mainnet
 * and testnet (Rusk 1.7.1), public transfers spend at most 1.87M gas, bridge
 * deposits 1.99M, shielding 28.5M, stakes 31.3M, and unstakes and reward
 * claims 33.2M. On testnet, stakes with Sozu spend 2.14M and unstakes from
 * it up to 3.71M. The defaults are at least 1.3x that, and the minimums at
 * least 5% above it. Shielded transfers and unshielding are Phoenix spends,
 * which Rusk's unreleased spend floor refuses below 24M gas.
 *
 * @type {Readonly<Record<GasOperation, Readonly<{ limit: bigint, minimum: bigint }>>>}
 */
export const GAS_DEFAULTS = Object.freeze({
  // Allocate shields or unshields depending on the amounts the user picks.
  allocate: Object.freeze({ limit: 50_000_000n, minimum: 30_000_000n }),

  // DuskEVM bridge deposits.
  bridge: Object.freeze({ limit: 5_000_000n, minimum: 2_500_000n }),

  "claim-rewards": Object.freeze({ limit: 50_000_000n, minimum: 35_000_000n }),

  // Stakes with Sozu and unstakes from it: calls of its pool.
  "liquid-staking": Object.freeze({ limit: 10_000_000n, minimum: 4_000_000n }),

  "public-transfer": Object.freeze({ limit: 2_500_000n, minimum: 2_000_000n }),
  shield: Object.freeze({ limit: 50_000_000n, minimum: 30_000_000n }),
  "shielded-transfer": Object.freeze({
    limit: 50_000_000n,
    minimum: 30_000_000n,
  }),
  stake: Object.freeze({ limit: 50_000_000n, minimum: 35_000_000n }),
  unshield: Object.freeze({ limit: 50_000_000n, minimum: 30_000_000n }),
  unstake: Object.freeze({ limit: 50_000_000n, minimum: 35_000_000n }),
});

/**
 * Proving and finalizing a DuskEVM withdrawal spend about 2.3M gas, but have
 * no gas editor, and finalizing consumes the withdrawal even if its own call
 * runs out of gas. They get a far larger limit, which costs nothing unless
 * the transaction fails.
 */
export const WITHDRAWAL_GAS_LIMIT = 50_000_000n;

const entries = Object.values(GAS_DEFAULTS);

/** The lowest minimum of all operations. */
export const LOWEST_GAS_LIMIT_MINIMUM = entries.reduce(
  (lowest, { minimum }) => (minimum < lowest ? minimum : lowest),
  entries[0].minimum
);

/** The highest default of all operations, valid for every one of them. */
export const HIGHEST_DEFAULT_GAS_LIMIT = entries.reduce(
  (highest, { limit }) => (limit > highest ? limit : highest),
  entries[0].limit
);

/**
 * The gas settings an operation starts from: the user's custom gas limit
 * and price if they set them, otherwise the operation's default limit and
 * the node's price.
 *
 * @param {GasOperation} operation
 * @param {Pick<SettingsStoreContent, "customGasLimit" | "customGasPrice">} settings
 * @param {bigint} nodeGasPrice The node's gas price, see `gasPriceStore`.
 * @returns {ContractGasSettings}
 */
export const getGasSettings = (
  operation,
  { customGasLimit, customGasPrice },
  nodeGasPrice
) => ({
  gasLimit: customGasLimit ?? GAS_DEFAULTS[operation].limit,
  gasPrice: customGasPrice ?? nodeGasPrice,
});

/**
 * The gas a form uses once its default gas changes, as when the node's price
 * arrives after the form opened: the new default, unless the gas was edited
 * in the form, which keeps its own.
 *
 * @param {ContractGasSettings} gas The gas the form uses.
 * @param {ContractGasSettings} previous The default gas the form had.
 * @param {ContractGasSettings} next The new default gas.
 * @returns {ContractGasSettings}
 */
export const followDefaultGas = (gas, previous, next) =>
  gas.gasLimit === previous.gasLimit && gas.gasPrice === previous.gasPrice
    ? { gasLimit: next.gasLimit, gasPrice: next.gasPrice }
    : gas;

/**
 * The gas bounds of an operation: its own minimum, and the global bounds for
 * the rest.
 *
 * @param {GasOperation} operation
 * @param {GasStoreContent} bounds
 * @returns {GasStoreContent}
 */
export const getGasLimits = (operation, bounds) => ({
  ...bounds,
  gasLimitLower: GAS_DEFAULTS[operation].minimum,
});
