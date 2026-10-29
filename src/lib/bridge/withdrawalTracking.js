import {
  getRememberedWithdrawalTransaction,
  hydrateWithdrawalActivity,
  updateWithdrawalTransaction,
  withdrawalActivityStore,
} from "$lib/bridge/withdrawalActivityStorage";
import {
  MAX_ACTIVITY_ITEMS,
  stringValue,
} from "$lib/bridge/withdrawalActivityValues";
import { withdrawalRecipient } from "$lib/bridge/bridgeCalls";
import { errorMessage } from "$lib/dusk/error";
import {
  loadDuskTransactionExecution,
  loadL2BlockTime,
  loadWithdrawalStatus,
} from "$lib/bridge/withdrawals";

const ACTIVE_POLL_INTERVAL_MS = 15_000;
const ACTION_POLL_INTERVAL_MS = 5_000;
const BACKGROUND_POLL_INTERVAL_MS = 60_000;
const activeTrackers = new Map();

export { withdrawalActivityStore };

/** @param {any} status */
function statusPatch(status) {
  const patch = /** @type {Record<string, any>} */ ({
    lastCheckedAt: Date.now(),
    stage: status.stage,
    trackingError: null,
  });

  for (const key of [
    "blockNumber",
    "claimOverdue",
    "proofRejected",
    "proofSubmitter",
    "readyAt",
    "readyAtExact",
    "statusMessage",
    "withdrawalHash",
  ]) {
    const value = status[key];

    if (value !== undefined) {
      patch[key] = key === "blockNumber" ? stringValue(value) : value;
    }
  }

  // The game this account's proof went against, which the next check reads
  // with the Portal: none while this account has no proof of it.
  patch.proofGame =
    typeof status.disputeGameProxy === "string"
      ? status.disputeGameProxy
      : null;

  // The amount, which a withdrawal found by its hash only has from here.
  if (typeof status.withdrawal?.value === "bigint") {
    patch.amountWei = status.withdrawal.value;
  }

  // Whom it pays on Dusk, as its message says.
  const recipient = withdrawalRecipient(status.withdrawal);

  if (recipient) {
    patch.recipient = recipient;
  }

  return patch;
}

/**
 * When a withdrawal was sent: the time of its DuskEVM block, read once. A
 * withdrawal found by its hash would otherwise show when it was looked up.
 *
 * @param {any} remembered
 * @param {any} status
 */
async function sentAtPatch(remembered, status) {
  if (remembered.sentAt || status.blockNumber === undefined) {
    return {};
  }

  try {
    return { sentAt: await loadL2BlockTime(BigInt(status.blockNumber)) };
  } catch {
    // Read again at the next refresh.
    return {};
  }
}

/**
 * Whether nothing is left to read about a withdrawal: it failed, or it is
 * finalized and when it was sent is known, or can't be. A withdrawal first
 * seen finalized while its block's time couldn't be read is read again.
 *
 * @param {any} item
 */
function isSettled(item) {
  return (
    item.stage === "failed" ||
    (item.stage === "finalized" &&
      (Boolean(item.sentAt) || (item.blockNumber ?? null) === null))
  );
}

/**
 * Reads when a finalized withdrawal was sent, which is all that is left to
 * read about it.
 *
 * @param {any} remembered
 */
async function refreshSentAt(remembered) {
  const patch = await sentAtPatch(remembered, remembered);

  return patch.sentAt
    ? updateWithdrawalTransaction(remembered.transactionHash, patch)
    : remembered;
}

/**
 * @param {"finalize" | "prove"} action
 * @param {any} status
 */
function submissionIsReflected(action, status) {
  if (action === "finalize") {
    return status.stage === "finalized";
  }

  return (
    Boolean(status.proofSubmitter) ||
    !["ready_to_prove", "submitted", "waiting_for_output"].includes(
      status.stage
    )
  );
}

/** @param {"finalize" | "prove"} action */
function submittedStage(action) {
  return action === "prove" ? "prove_submitted" : "finalize_submitted";
}

/**
 * @param {any} remembered
 * @param {any} status
 */
async function reconcilePendingSubmission(remembered, status) {
  const action = remembered.pendingAction;
  const transactionHash = remembered.pendingTransactionHash;

  if (!action || !transactionHash) {
    return { actionError: undefined, pending: false, status };
  }

  if (submissionIsReflected(action, status)) {
    return { actionError: null, pending: false, status };
  }

  let execution;

  try {
    execution = await loadDuskTransactionExecution(transactionHash);
  } catch {
    return {
      actionError: undefined,
      pending: true,
      status: { ...status, stage: submittedStage(action) },
    };
  }

  if (!execution?.error) {
    return {
      actionError: undefined,
      pending: true,
      status: { ...status, stage: submittedStage(action) },
    };
  }

  const actionError = `${action === "prove" ? "Proof" : "Finalization"} transaction failed: ${execution.error}`;

  // The card shows a short line; the raw error stays in the console.
  // eslint-disable-next-line no-console
  console.error(actionError);

  return { actionError, pending: false, status };
}

/**
 * Reconcile persisted UI state against the canonical L2 receipt and Dusk
 * portal state. Native proof/finalization failures are checked separately
 * because an executed Dusk transaction may still contain an execution error.
 *
 * @param {any} remembered
 */
async function refreshStatus(remembered) {
  try {
    const loadedStatus = await loadWithdrawalStatus(
      remembered.transactionHash,
      { proofGame: remembered.proofGame ?? null }
    );
    const reconciliation = await reconcilePendingSubmission(
      remembered,
      loadedStatus
    );
    const patch = {
      ...statusPatch(reconciliation.status),
      ...(await sentAtPatch(remembered, loadedStatus)),
      ...(reconciliation.actionError !== undefined
        ? { actionError: reconciliation.actionError }
        : {}),
      ...(reconciliation.pending
        ? {}
        : { pendingAction: null, pendingTransactionHash: null }),
    };

    return updateWithdrawalTransaction(remembered.transactionHash, patch);
  } catch (error) {
    const message = errorMessage(error);

    if (
      remembered.stage === "submitted" &&
      message === "Withdrawal transaction was not found."
    ) {
      return updateWithdrawalTransaction(remembered.transactionHash, {
        lastCheckedAt: Date.now(),
        trackingError: null,
      });
    }

    if (message === "Withdrawal transaction failed on DuskEVM.") {
      return updateWithdrawalTransaction(remembered.transactionHash, {
        actionError: message,
        lastCheckedAt: Date.now(),
        pendingAction: null,
        pendingTransactionHash: null,
        stage: "failed",
        trackingError: null,
      });
    }

    return updateWithdrawalTransaction(remembered.transactionHash, {
      lastCheckedAt: Date.now(),
      trackingError: message,
    });
  }
}

/**
 * Reads where a withdrawal is, or, once it is finalized, when it was sent if
 * that couldn't be read before.
 *
 * @param {string} transactionHash
 */
export async function refreshWithdrawalTransaction(transactionHash) {
  const remembered = getRememberedWithdrawalTransaction(transactionHash);
  const isFinalized = remembered?.stage === "finalized";

  if (!remembered || (isFinalized && isSettled(remembered))) {
    return remembered;
  }

  return isFinalized ? refreshSentAt(remembered) : refreshStatus(remembered);
}

/**
 * @param {string} transactionHash
 * @param {{ action: "finalize" | "prove", hash: string }} submission
 */
export function recordWithdrawalSubmission(transactionHash, submission) {
  const updated = updateWithdrawalTransaction(transactionHash, {
    actionError: null,
    pendingAction: submission.action,
    pendingTransactionHash: submission.hash,
    stage: submittedStage(submission.action),
    trackingError: null,
  });

  if (updated) {
    void trackWithdrawalTransaction(updated.transactionHash, {
      wake: true,
    });
  }

  return updated;
}

/** @param {number} milliseconds */
function trackerDelay(milliseconds) {
  /** @type {() => void} */
  let wake = () => {};
  const promise = new Promise((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    wake = () => {
      window.clearTimeout(timer);
      resolve(undefined);
    };
  });

  return { promise, wake };
}

/** @param {any} item */
function pollInterval(item) {
  if (item.pendingTransactionHash) {
    return ACTION_POLL_INTERVAL_MS;
  }

  return typeof document !== "undefined" &&
    document.visibilityState === "hidden"
    ? BACKGROUND_POLL_INTERVAL_MS
    : ACTIVE_POLL_INTERVAL_MS;
}

/**
 * Continue tracking independently of the activity route so bridge progress
 * survives navigation. Calling this for an active tracker wakes it immediately.
 *
 * @param {string} transactionHash
 * @param {{ wake?: boolean }} [options]
 */
export function trackWithdrawalTransaction(transactionHash, options = {}) {
  const hash = transactionHash.toLowerCase();
  const active = activeTrackers.get(hash);

  if (active) {
    if (options.wake) {
      active.wake();
    }
    return active.promise;
  }

  const tracker = /** @type {{ promise: Promise<any>, wake: () => void }} */ ({
    promise: Promise.resolve(null),
    wake: () => {},
  });
  tracker.promise = (async () => {
    while (true) {
      const item = await refreshWithdrawalTransaction(hash);

      if (!item || isSettled(item)) {
        return item;
      }

      const waiting = trackerDelay(pollInterval(item));
      tracker.wake = waiting.wake;
      await waiting.promise;
      tracker.wake = () => {};
    }
  })().finally(() => activeTrackers.delete(hash));

  activeTrackers.set(hash, tracker);
  return tracker.promise;
}

/** @param {string | null | undefined} account */
export function resumeWithdrawalTracking(account) {
  const normalizedAccount = account?.toLowerCase() ?? null;
  const withdrawals = hydrateWithdrawalActivity()
    .filter(
      (item) =>
        !isSettled(item) &&
        (item.account === null || item.account === normalizedAccount)
    )
    .slice(0, MAX_ACTIVITY_ITEMS);

  for (const withdrawal of withdrawals) {
    void trackWithdrawalTransaction(withdrawal.transactionHash);
  }

  return withdrawals;
}
