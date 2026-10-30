type ActivityKind =
  | "contract_call"
  | "shield"
  | "stake"
  | "transfer"
  | "unshield"
  | "unstake"
  | "withdraw_reward";

type ActivityDirection = "in" | "out" | "self";

/** Where one of the wallet's own transactions is, as it last saw it. */
type ActivityStatus = import("@dusk-network/app-core/activity").SendStatus;

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
  bridge?: import("@dusk-network/app-core/history").BridgeFacts;
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

/** A row of the history: one transaction, as `@dusk-network/app-core/activity` gives it. */
type ActivityRow = import("@dusk-network/app-core/activity").ActivityRow;

/** A shielded history's entry, as this browser keeps it. */
type KeptShieldedRow = {
  amount?: string;
  blockHeight: number;
  direction: ActivityDirection;
  error?: string;
  feePaid?: string;
  hash: string;
  kind: ActivityKind;
  privacy: "shielded";
  source: "shielded";
  status: "executed" | "failed";
  timestamp?: number;
};

/** A profile's shielded history, with the decoy heights it was asked among. */
type ShieldedHistoryRecord = {
  at: number;
  decoys: number[];
  entries: KeptShieldedRow[];
  fingerprint: string;
  ownerKey: string;
};

/** What the wallet records of a transaction it sends, for its history. */
type SentDetails = Omit<
  ActivityLocalRecord,
  "hash" | "id" | "ownerKey" | "status" | "submittedAt"
>;
