/** A route whose time is asked for: a deposit, a withdrawal, or a migration from an EVM chain. */
type RouteTimeRoute = Readonly<{
  from?: string;
  kind: "deposit" | "migration" | "withdrawal";
}>;

/** How long a route takes, and where that comes from; a withdrawal's parts too. */
type RouteTime = {
  /** The Portal's wait from a withdrawal's proof to its claim, in seconds. */
  maturity?: number;
  /** About how long after it's sent a withdrawal can be proved, in seconds: an output. */
  prove?: number;
  /** A withdrawal's wait until it can be proved at the latest, in seconds. */
  report?: number;
  seconds: number;
  source: "chain" | "network";
  /** A withdrawal's wait from the proof to the claim, in seconds. */
  wait?: number;
};

/** What the chains said about a network's routes, each part with when it was read. */
type ChainTimes = {
  deposit?: { at: number; lagSeconds: number };
  withdrawal?: {
    at: number;
    finalitySeconds: number;
    maturitySeconds: number;
    outputSeconds: number | null;
  };
};

/** A contract's data driver, as the bridge's timing reads use it. */
type BridgeDriver = {
  decodeOutputFn: (fnName: string, bytes: Uint8Array) => unknown;
  encodeInputFn: (fnName: string, json: string) => Uint8Array;
};
