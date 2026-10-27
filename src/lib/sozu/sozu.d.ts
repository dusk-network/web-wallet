/** Sozu's contracts on a network: its hub, and the pool to use. */
type SozuContracts = Readonly<{
  hub: string;
  pool: string;
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

/** What an account has with Sozu, read from its pool and its token. */
type SozuStatus = {
  contracts: SozuContracts & { stDusk: string | null };
  /** Sozu's fees, where they could be read. */
  fees?: SozuFees | null;
  pool: SozuPool;
  position: {
    /** The DUSK the account has staked with Sozu, as the pool counts it. */
    balance: bigint;

    /** The account's stDUSK. */
    stDusk: bigint;
  };
};

/**
 * A data driver: encodes a contract's arguments and decodes its replies.
 */
type SozuDriver = {
  decodeOutputFn: (fnName: string, bytes: Uint8Array) => unknown;
  encodeInputFn: (fnName: string, json: string) => Uint8Array;
};
