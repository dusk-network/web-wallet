/** Sozu's hub on a network, and the contracts to read until it answers. */
type SozuContracts = NonNullable<
  import("@dusk-network/networks").Network["sozu"]
>;

/** The pool's rate: the DUSK staked through it over the stDUSK there is. */
type SozuPool = import("@dusk-network/networks/sozu").SozuPool;

/** A fee rate as Sozu's substrate gives it: the numerator over the denominator. */
type SozuFeeRate = import("@dusk-network/networks/sozu").SozuFeeRate;

/** Sozu's fees: on each deposit, and on the rewards. */
type SozuFees = import("@dusk-network/networks/sozu").SozuFees;

/** Sozu's switches: each null when it couldn't be read. */
type SozuFlags = import("@dusk-network/networks/sozu").SozuFlags;

/**
 * What an account has with Sozu, as the wallet shows it: the package's
 * status, with the pool, its rate and both balances read.
 */
type SozuStatus = Omit<
  import("@dusk-network/networks/sozu").SozuStatus,
  "contracts" | "pool" | "position"
> & {
  contracts: {
    hub: string;
    pool: string;
    stDusk: string | null;
    substrate: string | null;
  };
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
