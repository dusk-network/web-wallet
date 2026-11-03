/**
 * What a send that failed ran into, for the screen that says so: one plain
 * sentence on what happened and what to do, and a heading of its own for a
 * transaction that may have gone out all the same.
 *
 * Before the transaction was handed to the node to broadcast, nothing went
 * out: the wallet switched or locked meanwhile, the EVM wallet declining
 * it, the node refusing it for a reason the wallet knows, the wallet
 * unable to sign it, or the node out of reach. Those say to try again
 * where that helps. Once the node was asked to broadcast it, or the EVM
 * wallet to send it (outcomeUnknown), it may have gone out: it says to
 * check History first, never to send it again. Its own message stays
 * under Details either way.
 */

import { isOutcomeUnknown } from "./outcomeUnknown";

/**
 * What sends nothing, by what it says: the node's or the wallet's own
 * refusals, which hold also once the transaction was handed over.
 *
 * @type {Array<[RegExp, string]>}
 */
const NOTHING_SENT = [
  // Another wallet opened, or the wallet locked, while the transaction
  // waited for the sync, or was built.
  [
    /WalletChangedError|wallet changed meanwhile|wallet not initialized|needs to be initialized|synchroni[sz]ation aborted/i,
    "The wallet changed or locked before it went out, so nothing was sent. Try again.",
  ],

  // Declined in the EVM wallet that was to send it.
  [
    /UserRejectedRequestError|user rejected|user denied/i,
    "It was declined in your EVM wallet, so nothing was sent.",
  ],

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
  [
    /nonce repeat|repeating nonce|spendid exists|exists in the (mempool|ledger)/i,
    "The network refused it: another transaction from this account came first. Wait a minute and try again.",
  ],
  [
    /nullifiers already spent|double nullifiers|repeating nullifiers/i,
    "The network refused it: some of the shielded DUSK it spends is spent already. Wait for the wallet to sync and try again.",
  ],

  // The shielded notes the wallet has don't cover it.
  [
    /insufficient (funds|balance)/i,
    "The shielded balance doesn't cover it and its fee, so nothing was sent. Lower the amount and try again.",
  ],

  // Its keys, signature or proof.
  [
    /invalid (proof|signature)|cannot verify the (proof|signature)|Driver\w*Error|failed to (archive|unarchive|deserialize)|unknown error code|\bprov(er|ing)\b|RuntimeError/i,
    "The wallet couldn't sign it, so nothing was sent. Reload the page and try again.",
  ],

  // Refused for a reason the wallet doesn't know: it's under Details.
  [
    /not accepted|this transaction is invalid|preverif/i,
    "The network refused it. See Details for why.",
  ],
];

/** The node out of reach, or too slow to answer, before it was asked to broadcast it. */
const UNREACHABLE =
  /TimeoutError|failed to fetch|fetch failed|networkerror|network error|load failed|timed out|time-?out|connection (refused|reset|closed)|unable to connect|websocket|"isTrusted"|bad gateway|service unavailable|unexpected \[5\d\d\]|status: 5\d\d|http request failed/i;

/**
 * @param {Error} error What the send rejected with
 * @returns {{ heading?: string, sentence: string }}
 */
export default function describeFailure(error) {
  const text = `${error?.name ?? ""}: ${error?.message ?? ""}`;
  const nothingSent = NOTHING_SENT.find(([pattern]) => pattern.test(text));

  if (nothingSent) {
    return { sentence: nothingSent[1] };
  }

  if (isOutcomeUnknown(error)) {
    return {
      heading: "Not confirmed",
      sentence:
        "It may have reached the network. Check History before you send it again.",
    };
  }

  return {
    sentence: UNREACHABLE.test(text)
      ? "Couldn't reach the network. Check your connection and try again."
      : "Something went wrong before it was sent. Try again.",
  };
}
