/**
 * Sozu: liquid staking on Dusk, run by a third party. Its hub contract
 * names the others; the pool given here is the one to use only until the
 * hub has been read.
 */

/** Sozu's site, for its own rules. */
export const SOZU_URL = "https://sozu.fi/";

/** The pool's functions the wallet calls. */
export const SOZU_FN = Object.freeze(
  /** @type {const} */ ({
    STAKE: "sozu_stake",
    UNSTAKE: "sozu_unstake",
  })
);

/** @type {Readonly<Record<string, SozuContracts>>} */
const SOZU_CONTRACTS = Object.freeze({
  mainnet: Object.freeze({
    hub: "b32c917e76abc6fcf2edbee0fa70231d8e19c405b18421794a11badfc66d2f26",
    pool: "6fdfdc713a18fc6ca2ad20eb2b4a3305a935ef47d6a872d9a4df8bc9fd9d169e",
  }),
  testnet: Object.freeze({
    hub: "bae85f8c24730a5a19fbe3d3bd58248ac8c302b62fe414a8c640d8c0ed286b9e",
    pool: "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2",
  }),
});

/**
 * Sozu's contracts on a network, or null where it has none.
 *
 * @param {string} networkName
 * @returns {SozuContracts | null}
 */
export const sozuContractsFor = (networkName) =>
  Object.hasOwn(SOZU_CONTRACTS, networkName)
    ? SOZU_CONTRACTS[networkName]
    : null;

/** Sozu's pools, for the history to name their calls. */
export const SOZU_POOLS = new Set(
  Object.values(SOZU_CONTRACTS).map(({ pool }) => pool)
);

/**
 * Whether a transaction is a stake or an unstake with Sozu: a call of one
 * of its pools.
 *
 * @param {{ contractId?: string | null, fnName?: string }} call
 */
export const isSozuCall = ({ contractId, fnName }) =>
  (fnName === SOZU_FN.STAKE || fnName === SOZU_FN.UNSTAKE) &&
  SOZU_POOLS.has(
    String(contractId ?? "")
      .toLowerCase()
      .replace(/^0x/, "")
  );
