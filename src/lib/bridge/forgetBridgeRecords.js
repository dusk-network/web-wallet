import { forgetDepositActivity } from "./depositActivityStorage";
import { forgetWithdrawalActivity } from "./withdrawalActivityStorage";

/** Where this browser keeps the bridge's transfers: deposits and withdrawals. */
const RECORDS_PREFIX = "dusk-evm:";

/** Where it keeps what the chains said about the bridge's times. */
const TIMES_PREFIX = `${CONFIG.LOCAL_STORAGE_APP_KEY}-bridge-times-`;

/**
 * Forgets the bridge transfers this browser keeps, deposits and withdrawals,
 * every wallet's; with `times`, as Reset does, the bridge's times on each
 * network too.
 *
 * @param {{ times?: boolean }} [options]
 */
export function forgetBridgeRecords({ times = false } = {}) {
  forgetDepositActivity();
  forgetWithdrawalActivity();

  try {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith(RECORDS_PREFIX) ||
        (times && key.startsWith(TIMES_PREFIX))
      ) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Nothing is kept where storage can't be read.
  }
}
