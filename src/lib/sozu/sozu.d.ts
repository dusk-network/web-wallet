/**
 * Sozu's contracts on a network: its hub, and the pool to use until the hub
 * names one, with the stDUSK token and the substrate where they're known.
 */
type SozuContracts = Readonly<{
  hub: string;
  pool: string;
  stDusk?: string;
  substrate?: string;
}>;

/** The pool's rate: the DUSK staked through it over the stDUSK there is. */
type SozuPool = {
  stake: bigint;
  supply: bigint;
};

/** A fee rate as Sozu's substrate gives it: the numerator over the denominator. */
type SozuFeeRate = {
  denominator: bigint;
  numerator: bigint;
};

/** Sozu's fees: on each deposit, and on the rewards. */
type SozuFees = {
  deposit: SozuFeeRate;
  reward: SozuFeeRate;
};

/**
 * Sozu's switches, as its substrate gives them: maintenance stops deposits;
 * while it synchronizes, a stake or an unstake can fail. Each is null when
 * it couldn't be read.
 */
type SozuFlags = {
  maintenance: boolean | null;
  synchronization: boolean | null;
};

/** What an account has with Sozu, read from its pool and its token. */
type SozuStatus = {
  /** The hub, and the pool and stDUSK token the figures were read from. */
  contracts: { hub: string; pool: string; stDusk: string | null };
  /** Sozu's fees, where they could be read. */
  fees?: SozuFees | null;
  /** Sozu's switches, where they could be read. */
  flags?: SozuFlags | null;
  pool: SozuPool;
  position: {
    /** The DUSK the account has staked with Sozu, as the pool counts it. */
    balance: bigint;

    /** The account's stDUSK. */
    stDusk: bigint;
  };
};

/**
 * A data driver: encodes a contract's arguments and decodes its replies,
 * and its events where it reads them.
 */
type SozuDriver = {
  decodeEvent?: (eventName: string, bytes: Uint8Array) => unknown;
  decodeOutputFn: (fnName: string, bytes: Uint8Array) => unknown;
  encodeInputFn: (fnName: string, json: string) => Uint8Array;
};
