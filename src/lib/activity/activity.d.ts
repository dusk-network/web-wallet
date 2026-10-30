type ActivityKind =
  | "contract_call"
  | "shield"
  | "stake"
  | "transfer"
  | "unshield"
  | "unstake"
  | "withdraw_reward";

type ActivityDirection = "in" | "out" | "self";

/** The outcome a row shows: "unknown" until the chain's is looked up. */
type ActivityStatus =
  | "executed"
  | "failed"
  | "mempool"
  | "removed"
  | "submitted"
  | "unknown";

/**
 * What the history reads of a `.dusk` name's call: what its reservation
 * holds, or its registration reveals of it once that checks out for the
 * history's account (null from a wallet that read it before), and the name a
 * registration registered (null when it didn't read as one).
 */
type ActivityNameFacts = {
  nameCommit?: import("$lib/activity/knownContracts").NameCommit | null;
  registeredName?: string | null;
};

/** A transaction's time, outcome, fee and call, from its details request. */
type ActivityDetails = import("@dusk-network/app-core/history").EntryDetails &
  ActivityNameFacts;

/** An entry as the store keeps it: amounts as strings. */
type ActivityStoredEntry = import("@dusk-network/app-core/history").KeptEntry &
  ActivityNameFacts & { id?: string; ownerKey?: string };

/** A kept entry as the history reads it: amounts as bigints. */
type ActivityEntry = import("@dusk-network/app-core/history").ReadEntry &
  ActivityNameFacts;

/** An account's sync state: the heights covered, highest first, and the head. */
type ActivityMeta = import("@dusk-network/app-core/history").HistoryState & {
  ownerKey: string;
};

/** One of the wallet's own transactions, kept until the archive has it. */
type ActivityLocalRecord = {
  amount?: string;

  /** What a call to the bridge does, as the wallet sent it. */
  bridge?: import("$lib/bridge/bridgeCalls").BridgeCall;
  contractId?: string;

  /** Which way the amount went, as the chain will say. */
  direction?: ActivityDirection;
  error?: string;
  feePaid?: string;
  fnName?: string;
  hash: string;
  id: string;
  kind: ActivityKind;
  memo?: string;
  ownerKey: string;
  privacy: "public" | "shielded";

  /**
   * Whether the chain's row has its outcome: kept only for what that row
   * lacks, as the name typed for the recipient.
   */
  settled?: boolean;
  status: ActivityStatus;
  submittedAt: number;
  to?: string;
  toName?: string;
};

/** A row of the history: one transaction, from the archive, the notes or the wallet. */
type ActivityRow = {
  amount?: string;
  blockHash?: string;
  blockHeight?: number;
  bridge?: import("$lib/bridge/bridgeCalls").BridgeCall | null;
  contractId?: string;
  counterparty?: string | null;
  counterpartyName?: string;
  deposit?: string;
  detailsAt?: number;
  direction?: ActivityDirection;
  error?: string;
  feePaid?: string;
  fnName?: string;
  from?: string;
  gasLimit?: string;
  gasPrice?: string;
  gasSpent?: string;
  hash: string;
  kind?: ActivityKind;
  memo?: string;
  nameCommit?: import("$lib/activity/knownContracts").NameCommit | null;
  privacy?: "public" | "shielded";
  profileIndex?: number;
  registeredName?: string | null;
  source: "archive" | "both" | "local" | "shielded";
  status: ActivityStatus;
  submittedAt?: number;
  success?: boolean | null;
  timestamp?: number;
  to?: string;
  toName?: string;
};

/** A profile's shielded history, with the decoy heights it was asked among. */
type ShieldedHistoryRecord = {
  at: number;
  decoys: number[];
  entries: ActivityRow[];
  fingerprint: string;
  ownerKey: string;
};

/** A shielded note of the profile: its leaf (note and height) and value. */
type ShieldedNote = {
  leaf: Uint8Array;
  nullifier: string;
  spent: boolean;
  value: bigint;
};

/** A block as the shielded history reads it. */
type ShieldedBlock = {
  events: any[];
  timestamp: number | null;
  txs: Map<string, any>;
};

/** What the wallet records of a transaction it sends, for its history. */
type SentDetails = Omit<
  ActivityLocalRecord,
  "hash" | "id" | "ownerKey" | "status" | "submittedAt"
>;
