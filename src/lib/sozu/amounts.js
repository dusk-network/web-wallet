/** Lux in one DUSK, and in one stDUSK. */
const ONE = 1_000_000_000n;

const U64_MAX = 0xffff_ffff_ffff_ffffn;

/**
 * An amount as Sozu's pool takes it: a u64, in 8 bytes, little-endian.
 *
 * @param {bigint} value
 * @returns {Uint8Array}
 */
export function encodeU64(value) {
  if (value < 0n || value > U64_MAX) {
    throw new RangeError("The amount doesn't fit in a u64");
  }

  const bytes = new Uint8Array(8);

  new DataView(bytes.buffer).setBigUint64(0, value, true);

  return bytes;
}

/**
 * @param {unknown} value
 * @returns {bigint}
 */
const toLux = (value) => {
  try {
    const lux = BigInt(/** @type {string | number | bigint} */ (value ?? 0));

    return lux > 0n ? lux : 0n;
  } catch {
    return 0n;
  }
};

/**
 * The pool's rate as its `exchange_rate` gives it: the DUSK staked through
 * the pool over the stDUSK there is.
 *
 * @param {unknown} rate
 * @returns {SozuPool}
 */
export function parsePool(rate) {
  const { denominator, numerator } = /** @type {Record<string, unknown>} */ (
    rate ?? {}
  );

  return { stake: toLux(numerator), supply: toLux(denominator) };
}

/**
 * About how much stDUSK a stake of `amount` gets now, before any fee Sozu
 * takes; null without a rate.
 *
 * @param {bigint} amount
 * @param {SozuPool | null} pool
 * @returns {bigint | null}
 */
export const stDuskFor = (amount, pool) =>
  pool && pool.stake > 0n && pool.supply > 0n
    ? (amount * pool.supply) / pool.stake
    : null;

/**
 * The least a stake gets any stDUSK for at the rate now, in lux: 1 without
 * a rate.
 *
 * @param {SozuPool | null} pool
 * @returns {bigint}
 */
export const leastSozuStake = (pool) =>
  pool && pool.stake > 0n && pool.supply > 0n
    ? (pool.stake + pool.supply - 1n) / pool.supply
    : 1n;

/**
 * What one stDUSK is worth now, in lux; null without a rate.
 *
 * @param {SozuPool | null} pool
 * @returns {bigint | null}
 */
export const duskPerStDusk = (pool) =>
  pool && pool.stake > 0n && pool.supply > 0n
    ? (ONE * pool.stake) / pool.supply
    : null;

/**
 * An amount the pool's reads give, as lux.
 *
 * @param {unknown} value
 */
export const readLux = toLux;
