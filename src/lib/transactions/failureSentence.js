/**
 * What a transaction that failed before it was sent hit, in one plain
 * sentence that says what to do: the node out of reach, the network
 * refusing it, for its reason where it says one the wallet knows, the
 * wallet switched or locked meanwhile, or the wallet unable to sign it. Any
 * other failure gets "Try again.": its own message stays under Details.
 */

/** @type {Array<[RegExp, string]>} */
const SENTENCES = [
  // Another wallet opened, or the wallet locked, while the transaction
  // waited for the sync, or was built.
  [
    /WalletChangedError|wallet changed meanwhile|wallet not initialized|needs to be initialized|synchroni[sz]ation aborted/i,
    "The wallet changed or locked before it went out, so nothing was sent. Try again.",
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

  // The node out of reach, or too slow to answer.
  [
    /TimeoutError|failed to fetch|fetch failed|networkerror|network error|load failed|timed out|time-?out|connection (refused|reset|closed)|unable to connect|websocket|"isTrusted"|bad gateway|service unavailable|unexpected \[5\d\d\]|status: 5\d\d|http request failed/i,
    "Couldn't reach the network. Check your connection and try again.",
  ],
];

/**
 * @param {Error} error What the send rejected with
 * @returns {string}
 */
export default function failureSentence(error) {
  const text = `${error?.name ?? ""}: ${error?.message ?? ""}`;

  return SENTENCES.find(([pattern]) => pattern.test(text))?.[1] ?? "Try again.";
}
