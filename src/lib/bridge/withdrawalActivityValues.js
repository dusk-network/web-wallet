export const MAX_ACTIVITY_ITEMS = 12;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DUSK_TX_HASH_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * @typedef {object} WithdrawalActivityItem
 * @property {string | null} account
 * @property {string | null} actionError
 * @property {string | null} amountWei
 * @property {string | null} blockNumber
 * @property {string | null} challengePeriodEnd
 * @property {number} chainId
 * @property {number} createdAt
 * @property {string | null} explorerStatus
 * @property {string | null} l1TransactionHash
 * @property {number | null} lastCheckedAt
 * @property {"finalize" | "prove" | null} pendingAction
 * @property {string | null} pendingTransactionHash
 * @property {string | null} proofSubmitter
 * @property {string | null} readyAt
 * @property {"explorer" | "local"} source
 * @property {"failed" | "finalize_submitted" | "finalized" | "prove_submitted" | "proven_waiting" | "ready_to_finalize" | "ready_to_prove" | "submitted" | "waiting_for_output"} stage
 * @property {string | null} statusMessage
 * @property {string | null} timestamp
 * @property {string | null} trackingError
 * @property {`0x${string}`} transactionHash
 * @property {`0x${string}` | null} withdrawalHash
 */

/**
 * @param {unknown} value
 */
export function errorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}

/**
 * @param {unknown} value
 */
function addressHash(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "hash" in value) {
    return typeof value.hash === "string" ? value.hash : null;
  }

  return null;
}

/**
 * @param {unknown} value
 */
export function normalizedAddress(value) {
  const hash = addressHash(value);

  return hash && EVM_ADDRESS_PATTERN.test(hash) ? hash.toLowerCase() : null;
}

/**
 * @param {unknown} value
 * @returns {`0x${string}` | null}
 */
export function normalizedTxHash(value) {
  return typeof value === "string" && TX_HASH_PATTERN.test(value)
    ? /** @type {`0x${string}`} */ (value.toLowerCase())
    : null;
}

/**
 * Normalize the native transaction ID returned by a Dusk client. Dusk
 * explorers and GraphQL use the unprefixed form, while some callers add the
 * Ethereum-style prefix before persistence.
 *
 * @param {unknown} value
 */
export function normalizedDuskTxHash(value) {
  return typeof value === "string" && DUSK_TX_HASH_PATTERN.test(value)
    ? value.replace(/^0x/u, "").toLowerCase()
    : null;
}

/**
 * @param {unknown} value
 */
export function normalizedTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {unknown} value
 */
export function stringValue(value) {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
    ? String(value)
    : null;
}

/**
 * @param {unknown} value
 */
export function normalizedAmountWei(value) {
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : null;
  }

  return typeof value === "string" && /^\d+$/u.test(value) ? value : null;
}
