/**
 * What a send that failed ran into, for the screen that says so: one plain
 * sentence on what happened and what to do, a heading of its own for a
 * transaction that may have gone out all the same, and whether it can be
 * tried again (`canRetry`).
 *
 * Before the transaction was handed to the node to broadcast, nothing went
 * out: the wallet switched or locked meanwhile, the EVM wallet declining
 * it, the node refusing it for a reason the wallet knows, the wallet
 * unable to sign it, or the node out of reach. Those say to try again
 * where that helps. Once the node was asked to broadcast it, or the EVM
 * wallet to send it (outcomeUnknown), it may have gone out: it says to
 * check History first, never to send it again, and only a refusal, which
 * holds once it was handed over too, says otherwise: the node's, or an EVM
 * wallet's that proves it sent nothing. A refusal for what another transaction
 * spent says the same: that one may be an earlier try of this one, whose
 * answer got lost. Its own message stays under Details either way.
 */

import { mdiTimerSand } from "@mdi/js";

import { isOutcomeUnknown } from "./outcomeUnknown";

/** How an EVM wallet says it was turned down. */
const DECLINED = /UserRejectedRequestError|user rejected|user denied/i;

/**
 * What the node or a wallet refused, by what they say: nothing went out, also
 * once the transaction was handed over.
 *
 * @type {Array<[RegExp, string]>}
 */
const REFUSED = [
  // Declined in the EVM wallet that was to send it.
  [DECLINED, "It was declined in your EVM wallet, so nothing was sent."],

  // The node's reasons for refusing it, where the wallet knows them.
  [
    /gas price lower than (the )?minimum/i,
    "The network refused it: the gas price is under its minimum. Raise it and try again.",
  ],
  [
    /gas limit lower than (the )?minimum/i,
    "The network refused it: the gas limit is under its minimum. Raise it and try again.",
  ],
  [
    /value spent (larger than account holds|will overflow)/i,
    "The network refused it: the balance doesn't cover it and its fee. Lower the amount and try again.",
  ],

  // What pays for it doesn't cover it, as the wallet finds before it sends
  // it: its shielded notes, or the EVM wallet's balance for a withdrawal.
  [
    /InsufficientFundsError|insufficient (funds|balance)/i,
    "The balance doesn't cover it and its fee, so nothing was sent. Lower the amount and try again.",
  ],

  // Its signature or proof, as the node checks them.
  [
    /invalid (proof|signature)|cannot verify the (proof|signature)/i,
    "The wallet couldn't sign it, so nothing was sent. Reload the page and try again.",
  ],

  // Refused for a reason the wallet doesn't know: it's under Details.
  [
    /not accepted|this transaction is invalid|preverif/i,
    "The network refused it. See Details for why.",
  ],
];

/**
 * What only comes up as a transaction is made, before anything was handed
 * over: it says nothing of one that was.
 *
 * @type {Array<[RegExp, string]>}
 */
const NOT_MADE = [
  // Another wallet opened, or the wallet locked, while the transaction
  // waited for the sync, or was built.
  [
    /WalletChangedError|wallet changed meanwhile|wallet not initialized|needs to be initialized|synchroni[sz]ation aborted/i,
    "The wallet changed or locked before it went out, so nothing was sent. Try again.",
  ],

  // The address, which the wallet reads as it builds the transaction.
  [
    /DriverDeserializeError|failed to deserialize/i,
    "The wallet couldn't read the address, so nothing was sent. Check it and try again.",
  ],

  // Its keys, signature or proof.
  [
    /Driver\w*Error|failed to (archive|unarchive)|unknown error code|\bprov(er|ing)\b|RuntimeError/i,
    "The wallet couldn't sign it, so nothing was sent. Reload the page and try again.",
  ],
];

/**
 * The node refusing it for what another transaction from this account spent
 * already: this try didn't go, but that one did, and it may be an earlier try
 * of this one.
 *
 * @type {Array<[RegExp, string]>}
 */
const CAME_FIRST = [
  [
    /nonce repeat|repeating nonce|spendid exists|exists in the (mempool|ledger)/i,
    "The network refused it: another transaction from this account came first.",
  ],
  [
    /nullifiers already spent|double nullifiers|repeating nullifiers/i,
    "The network refused it: some of the shielded DUSK it spends is spent already.",
  ],
];

/** What stops a call before the EVM wallet is asked for it, by its name. */
const NOT_ASKED =
  /^(Connector(NotConnected|AccountNotFound|ChainMismatch|UnavailableReconnecting)|ChainMismatch|ChainNotFound|AccountNotFound)Error$/;

/** An EVM wallet saying it won't: not authorized, or no such method. */
const WONT_DO = /^(UnauthorizedProvider|UnsupportedProviderMethod)Error$/;

/**
 * An error, and the errors it came wrapped around.
 *
 * @param {any} error
 * @returns {any[]}
 */
function causesOf(error) {
  /** @type {any[]} */
  const causes = [];

  for (
    let cause = error;
    cause && typeof cause === "object" && !causes.includes(cause);
    cause = cause.cause
  ) {
    causes.push(cause);
  }

  return causes;
}

/**
 * Whether an EVM chain's own check of a call says it would revert, as a wallet
 * finds in its gas estimate, before it sends it: what it says then is no
 * answer to a send. viem words any internal error a wallet gives as a revert
 * too, which proves nothing, so this goes by what came with it: the revert's
 * code, its data, or the node's words.
 *
 * @param {any[]} causes
 */
const wouldRevert = (causes) =>
  causes.some(
    (cause) =>
      cause.code === 3 ||
      cause.data?.code === 3 ||
      (typeof cause.raw === "string" && cause.raw !== "0x") ||
      /execution reverted|gas required exceeds allowance/i.test(
        `${cause.message} ${cause.data?.message ?? ""}`
      )
  );

/**
 * What an EVM wallet's error proves wasn't sent, as said on the screen: "" for
 * anything that doesn't, as an error that says nothing of whether the wallet
 * went on to send it.
 *
 * @param {any} error
 */
function evmRefusal(error) {
  const causes = causesOf(error);

  /** @param {RegExp} names */
  const isOneOf = (names) => causes.some(({ name }) => names.test(name));

  return isOneOf(NOT_ASKED)
    ? "Your EVM wallet isn't on this account or network, so nothing was sent. Check it and try again."
    : isOneOf(WONT_DO)
      ? "Your EVM wallet refused it, so nothing was sent. See Details for why."
      : wouldRevert(causes)
        ? "The network would refuse it, so nothing was sent. See Details for why."
        : "";
}

/** The node out of reach, or too slow to answer, before it was asked to broadcast it. */
const UNREACHABLE =
  /TimeoutError|failed to fetch|fetch failed|networkerror|network error|load failed|timed out|time-?out|connection (refused|reset|closed)|unable to connect|websocket|"isTrusted"|bad gateway|service unavailable|unexpected \[5\d\d\]|status: 5\d\d|http request failed/i;

/** What to check first where there's no History to: the balance. */
export const CHECK_BALANCE_FIRST =
  "Wait a few minutes and check your balance before you send it again.";

/** What to check first for a withdrawal, which History doesn't show. */
export const CHECK_EVM_WALLET_FIRST =
  "Check your EVM wallet's activity before you send it again.";

/**
 * Whether the person turned it down in their EVM wallet.
 *
 * @param {unknown} error
 */
export const isDeclinedInWallet = (error) =>
  DECLINED.test(
    `${/** @type {Error} */ (error)?.name ?? ""}: ${/** @type {Error} */ (error)?.message ?? ""}`
  );

/**
 * @param {Error} error What the send rejected with
 * @param {{ checkFirst?: string }} [options] What to check before sending
 *   it again, once it may have gone out: History, unless said otherwise
 * @returns {{ canRetry?: boolean, heading?: string, icon?: string, outcomeUnknown?: boolean, sentence: string }}
 *   `canRetry` holds only where nothing went out: never invite a send again
 *   without it
 */
export default function describeFailure(
  error,
  { checkFirst = "Check History before you send it again." } = {}
) {
  const text = `${error?.name ?? ""}: ${error?.message ?? ""}`;
  const handedOver = isOutcomeUnknown(error);
  const cameFirst = CAME_FIRST.find(([pattern]) => pattern.test(text));

  if (cameFirst) {
    return { outcomeUnknown: true, sentence: `${cameFirst[1]} ${checkFirst}` };
  }

  const nothingSent = (handedOver ? REFUSED : [...REFUSED, ...NOT_MADE]).find(
    ([pattern]) => pattern.test(text)
  );

  if (nothingSent) {
    return { canRetry: true, sentence: nothingSent[1] };
  }

  const refused = evmRefusal(error);

  if (refused) {
    return { canRetry: true, sentence: refused };
  }

  if (handedOver) {
    return {
      heading: "Not confirmed",
      icon: mdiTimerSand,
      outcomeUnknown: true,
      sentence: `It may have reached the network. ${checkFirst}`,
    };
  }

  return {
    canRetry: true,
    sentence: UNREACHABLE.test(text)
      ? "Couldn't reach the network. Check your connection and try again."
      : "Something went wrong before it was sent. Try again.",
  };
}
