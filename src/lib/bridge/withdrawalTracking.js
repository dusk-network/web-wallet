import {
  getRememberedWithdrawalTransaction,
  hydrateWithdrawalActivity,
  updateWithdrawalTransaction,
  withdrawalActivityStore,
} from "$lib/bridge/withdrawalActivityStorage";
import {
  MAX_ACTIVITY_ITEMS,
  errorMessage,
  stringValue,
} from "$lib/bridge/withdrawalActivityValues";
import {
  loadDuskTransactionExecution,
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
    "proofSubmitter",
    "readyAt",
    "statusMessage",
    "withdrawalHash",
  ]) {
    const value = status[key];

    if (value !== undefined) {
      patch[key] = key === "blockNumber" ? stringValue(value) : value;
    }
  }

  return patch;
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

  return {
    actionError: `${action === "prove" ? "Proof" : "Finalization"} transaction failed: ${execution.error}`,
    pending: false,
    status,
  };
}

/**
 * Reconcile persisted UI state against the canonical L2 receipt and Dusk
 * portal state. Native proof/finalization failures are checked separately
 * because an executed Dusk transaction may still contain an execution error.
 *
 * @param {string} transactionHash
 */
export async function refreshWithdrawalTransaction(transactionHash) {
  const remembered = getRememberedWithdrawalTransaction(transactionHash);

  if (!remembered || remembered.stage === "finalized") {
    return remembered;
  }

  try {
    const loadedStatus = await loadWithdrawalStatus(remembered.transactionHash);
    const reconciliation = await reconcilePendingSubmission(
      remembered,
      loadedStatus
    );
    const patch = {
      ...statusPatch(reconciliation.status),
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

      if (!item || item.stage === "finalized" || item.stage === "failed") {
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
        item.stage !== "finalized" &&
        item.stage !== "failed" &&
        (item.account === null || item.account === normalizedAccount)
    )
    .slice(0, MAX_ACTIVITY_ITEMS);

  for (const withdrawal of withdrawals) {
    void trackWithdrawalTransaction(withdrawal.transactionHash);
  }

  return withdrawals;
}
