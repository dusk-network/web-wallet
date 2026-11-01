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
import { recipientOf } from "$lib/bridge/bridgeCalls";
import { errorMessage } from "$lib/dusk/error";
import {
  loadDuskTransactionExecution,
  loadL2BlockTime,
  loadWithdrawalStatus,
  withOneLatestBlock,
} from "$lib/bridge/withdrawals";
import { walletDataScope } from "$lib/wallets/dataNames";

/**
 * Each withdrawal is followed for the wallet that keeps it, open as the
 * following begins (`scope`): what a check reads is kept for that wallet,
 * and no check begins once another wallet opened, as a check reads for the
 * account open.
 *
 * @typedef {import("$lib/wallets/dataNames").WalletDataScope} WalletDataScope
 */

const ACTIVE_POLL_INTERVAL_MS = 15_000;
const ACTION_POLL_INTERVAL_MS = 5_000;
const BACKGROUND_POLL_INTERVAL_MS = 60_000;

/** How often a proof waiting for its claim date is checked before that date. */
const PROVEN_POLL_INTERVAL_MS = 10 * 60_000;

/** The longest a round's timer waits: a claim date can be days away. */
const MAX_ROUND_WAIT_MS = 60 * 60_000;

/**
 * The withdrawals followed, by hash: when each is checked next, for which
 * wallet, and what its callers wait on, settled once nothing is left to
 * read about it. `woken` marks one asked for again while it was being
 * checked.
 *
 * @type {Map<string, PromiseWithResolvers<any> & { due: number, scope: WalletDataScope, woken: boolean }>}
 */
const trackers = new Map();

/**
 * The checks under way, by wallet and hash: one asked for meanwhile shares
 * the answer, and a round leaves it out until it ends.
 *
 * @type {Map<string, Promise<any>>}
 */
const checking = new Map();

/**
 * @param {WalletDataScope} scope
 * @param {string} hash
 */
const checkKey = (scope, hash) => `${scope.id} ${hash}`;

/** @type {number | undefined} */
let roundTimer;

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
  if (typeof status.facts?.amountWei === "bigint") {
    patch.amountWei = status.facts.amountWei;
  }

  // Whom it pays on Dusk, as its message says.
  const recipient = recipientOf(status.facts?.recipient);

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
 * @param {WalletDataScope} scope
 */
async function refreshSentAt(remembered, scope) {
  const patch = await sentAtPatch(remembered, remembered);

  return patch.sentAt
    ? updateWithdrawalTransaction(remembered.transactionHash, patch, scope)
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
 * @param {WalletDataScope} scope
 */
async function refreshStatus(remembered, scope) {
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

    return updateWithdrawalTransaction(
      remembered.transactionHash,
      patch,
      scope
    );
  } catch (error) {
    return updateWithdrawalTransaction(
      remembered.transactionHash,
      failedCheckPatch(remembered, errorMessage(error)),
      scope
    );
  }
}

/**
 * What a check that failed with `message` keeps of a withdrawal.
 *
 * @param {any} remembered
 * @param {string} message
 * @returns {Partial<import("./withdrawalActivityValues").WithdrawalActivityItem>}
 */
function failedCheckPatch(remembered, message) {
  if (
    remembered.stage === "submitted" &&
    message === "Withdrawal transaction was not found."
  ) {
    return { lastCheckedAt: Date.now(), trackingError: null };
  }

  if (message === "Withdrawal transaction failed on DuskEVM.") {
    return {
      actionError: message,
      lastCheckedAt: Date.now(),
      pendingAction: null,
      pendingTransactionHash: null,
      stage: "failed",
      trackingError: null,
    };
  }

  return { lastCheckedAt: Date.now(), trackingError: message };
}

/**
 * A withdrawal as its wallet keeps it, read again: nothing is read once
 * another wallet opened.
 *
 * @param {string} transactionHash
 * @param {WalletDataScope} scope
 */
async function readWithdrawal(transactionHash, scope) {
  const remembered = getRememberedWithdrawalTransaction(transactionHash, scope);
  const isFinalized = remembered?.stage === "finalized";

  if (
    !remembered ||
    (isFinalized && isSettled(remembered)) ||
    !scope.isOpen()
  ) {
    return remembered;
  }

  return isFinalized
    ? refreshSentAt(remembered, scope)
    : refreshStatus(remembered, scope);
}

/**
 * Reads where a withdrawal is, or, once it is finalized, when it was sent if
 * that couldn't be read before, for the wallet open as it's asked for. A
 * check of it under way gives its answer instead, and the check sets when a
 * followed withdrawal is checked next.
 *
 * @param {string} transactionHash
 * @param {WalletDataScope} [scope]
 */
export function refreshWithdrawalTransaction(
  transactionHash,
  scope = walletDataScope()
) {
  const hash = transactionHash.toLowerCase();
  const key = checkKey(scope, hash);
  let check = checking.get(key);

  if (!check) {
    const at = Date.now();

    check = readWithdrawal(transactionHash, scope).then(
      (item) => {
        checking.delete(key);
        checked(hash, item, at, scope);

        return item;
      },
      (error) => {
        checking.delete(key);
        scheduleRound();

        throw error;
      }
    );
    checking.set(key, check);
  }

  return check;
}

/**
 * Keeps a proof or a claim sent for a withdrawal, for the wallet that sent
 * it (`scope`, taken as it was sent), and follows it while that wallet is
 * open.
 *
 * @param {string} transactionHash
 * @param {{ action: "finalize" | "prove", hash: string }} submission
 * @param {WalletDataScope} [scope]
 */
export function recordWithdrawalSubmission(
  transactionHash,
  submission,
  scope = walletDataScope()
) {
  const updated = updateWithdrawalTransaction(
    transactionHash,
    {
      actionError: null,
      pendingAction: submission.action,
      pendingTransactionHash: submission.hash,
      stage: submittedStage(submission.action),
      trackingError: null,
    },
    scope
  );

  if (updated) {
    void trackWithdrawalTransaction(
      updated.transactionHash,
      { wake: true },
      scope
    );
  }

  return updated;
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
 * Whether a withdrawal only waits for its proof's claim date: proved, with
 * nothing sent, and its last check read everything.
 *
 * @param {any} item
 */
function waitsForClaimDate(item) {
  return (
    item.stage === "proven_waiting" &&
    !item.pendingTransactionHash &&
    !item.trackingError &&
    (Boolean(item.sentAt) || (item.blockNumber ?? null) === null)
  );
}

/**
 * When a followed withdrawal checked at `at` is checked next: a poll later,
 * in the round of another one due about then, so that their reads go out
 * together; a proof waiting for its claim date every 10 minutes until that
 * date, as a refused proof is made again.
 *
 * @param {string} hash
 * @param {any} item
 * @param {number} at
 */
function nextCheck(hash, item, at) {
  const poll = pollInterval(item);
  const readyAt = Number(item.readyAt) * 1_000;

  if (waitsForClaimDate(item) && readyAt > at + poll) {
    return Math.min(readyAt, at + PROVEN_POLL_INTERVAL_MS);
  }

  const near = Array.from(trackers)
    .filter(
      ([other, { due }]) =>
        other !== hash && Math.abs(due - (at + poll)) <= poll / 2
    )
    .map(([, { due }]) => due);

  return near.length ? Math.min(...near) : at + poll;
}

/**
 * After a check of a followed withdrawal: when it is checked next, or, once
 * nothing is left to read about it, its callers have it.
 *
 * @param {string} hash
 * @param {any} item
 * @param {number} at When the check started
 * @param {WalletDataScope} scope Whose check it was
 */
function checked(hash, item, at, scope) {
  const tracker = trackers.get(hash);

  if (!tracker || tracker.scope.id !== scope.id) {
    return;
  }

  if (!item || isSettled(item)) {
    trackers.delete(hash);
    tracker.resolve(item);
  } else {
    // Asked for again while it was being checked: checked again at once.
    tracker.due = tracker.woken ? Date.now() : nextCheck(hash, item, at);
    tracker.woken = false;
  }

  scheduleRound();
}

/** Sets the next round, at the first one due of those not being checked. */
function scheduleRound() {
  window.clearTimeout(roundTimer);

  const waiting = Array.from(trackers)
    .filter(([hash, { scope }]) => !checking.has(checkKey(scope, hash)))
    .map(([, { due }]) => due);

  if (waiting.length === 0) {
    return;
  }

  const first = Math.min(...waiting);

  roundTimer = window.setTimeout(
    runRound,
    Math.min(Math.max(0, first - Date.now()), MAX_ROUND_WAIT_MS)
  );
}

/**
 * Ends the following of a wallet's withdrawals once another wallet opened:
 * their callers have them as that wallet keeps them.
 */
function dropClosed() {
  for (const [hash, tracker] of trackers) {
    if (!tracker.scope.isOpen()) {
      trackers.delete(hash);
      tracker.resolve(getRememberedWithdrawalTransaction(hash, tracker.scope));
    }
  }
}

/**
 * Checks every followed withdrawal that is due, together: their reads on
 * Dusk go out together, with one read of its latest block. The next round
 * doesn't wait for this one's checks to end: each sets its own next check.
 */
function runRound() {
  dropClosed();

  const now = Date.now();
  const dueNow = Array.from(trackers).filter(
    ([hash, { due, scope }]) =>
      due <= now && !checking.has(checkKey(scope, hash))
  );

  void withOneLatestBlock(() =>
    Promise.all(
      dueNow.map(([hash, tracker]) =>
        refreshWithdrawalTransaction(hash, tracker.scope).catch((error) => {
          if (trackers.get(hash) === tracker) {
            trackers.delete(hash);
            tracker.reject(error);
          }
        })
      )
    )
  );
  scheduleRound();
}

/**
 * A followed withdrawal, checked at once, or a poll after its last check.
 *
 * @param {any} remembered
 * @param {WalletDataScope} scope
 */
function newTracker(remembered, scope) {
  const now = Date.now();

  return {
    ...Promise.withResolvers(),
    due: remembered.lastCheckedAt
      ? Math.max(now, remembered.lastCheckedAt + pollInterval(remembered))
      : now,
    scope,
    woken: false,
  };
}

/**
 * Continue tracking independently of the activity route so bridge progress
 * survives navigation: each followed withdrawal is checked in rounds, as it
 * comes due, while the wallet open as it's asked for (`scope`) is. Calling
 * this for an active tracker with `wake` checks it at once.
 *
 * @param {string} transactionHash
 * @param {{ wake?: boolean }} [options]
 * @param {WalletDataScope} [scope]
 */
export function trackWithdrawalTransaction(
  transactionHash,
  options = {},
  scope = walletDataScope()
) {
  const hash = transactionHash.toLowerCase();

  dropClosed();

  let tracker = trackers.get(hash);

  if (!tracker) {
    const remembered = getRememberedWithdrawalTransaction(hash, scope);

    // Nothing to follow: it isn't kept here, nothing is left to read, or
    // its wallet isn't open.
    if (!remembered || isSettled(remembered) || !scope.isOpen()) {
      return Promise.resolve(remembered);
    }

    tracker = newTracker(remembered, scope);
    trackers.set(hash, tracker);
  } else if (!options.wake) {
    return tracker.promise;
  }

  if (options.wake) {
    tracker.due = Date.now();
    tracker.woken = checking.has(checkKey(tracker.scope, hash));
  }

  scheduleRound();

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
