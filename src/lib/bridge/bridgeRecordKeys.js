/**
 * Where this browser keeps a wallet's bridge transfers, before the ending
 * of the wallet's names ($lib/wallets/dataNames): the deposits, the
 * withdrawals, and the last withdrawal sent.
 */

export const DEPOSIT_ACTIVITY_KEY = "dusk-evm:deposit-activity:v1";
export const WITHDRAWAL_ACTIVITY_KEY = "dusk-evm:withdrawal-activity:v1";
export const LAST_WITHDRAWAL_KEY = "dusk-evm:last-withdrawal-tx-hash";

/**
 * Forgets one wallet's bridge transfers, as it's removed, by the ending of
 * its names.
 *
 * @param {string} suffix
 */
export function forgetWalletBridgeRecords(suffix) {
  try {
    for (const name of [
      DEPOSIT_ACTIVITY_KEY,
      LAST_WITHDRAWAL_KEY,
      WITHDRAWAL_ACTIVITY_KEY,
    ]) {
      localStorage.removeItem(`${name}${suffix}`);
    }
  } catch {
    // Nothing is kept where storage can't be read.
  }
}
