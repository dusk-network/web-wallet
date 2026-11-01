type Readable<T> = import("svelte/store").Readable<T>;

type Writable<T> = import("svelte/store").Writable<T>;

type GasStoreContent = {
  gasLimitLower: bigint;
  gasLimitUpper: bigint;
  gasPriceLower: bigint;
};

type GasStore = Readable<GasStoreContent>;

type GasPriceStore = Readable<bigint> & {
  refresh: () => Promise<void>;
  startRefreshing: () => () => void;
};

type SettingsStoreContent = {
  autoLockMinutes: number;
  currency: string;
  customGasLimit: bigint | null;
  customGasPrice: bigint | null;
  darkMode: boolean;
  dashboardTransactionLimit: number;
  gasLimit: bigint;
  gasPrice: bigint;
  hideBalances: boolean;
  language: string;
  userId: string;
  walletCreationBlockHeight: bigint;
};

type SettingsStore = Writable<SettingsStoreContent> & {
  reset: () => void;
  resetGasSettings: () => void;
};

type TransactionInfo = Awaited<ReturnType<Network["execute"]>>;

type TransactionsStoreContent = { transactions: Transaction[] };

type TransactionsStore = Readable<TransactionsStoreContent>;

type OperationsStoreContent = { currentOperation: string };

type OperationsStore = Writable<OperationsStoreContent>;

type NetworkStoreContent = {
  /** The chain ID the node gives: 0 local, 1 mainnet, 2 testnet, 3 devnet. */
  chainId: number | null;
  get connected(): boolean;
  /** The network's contracts and routes, or null for a chain without a file. */
  net: import("@dusk-network/networks").Network | null;
  networkName: string;
};

type NetworkStoreServices = {
  checkBlock: (height: bigint, hash: string) => Promise<boolean>;
  connect: () => Promise<Network>;
  disconnect: () => Promise<void>;
  getAccountSyncer: () => Promise<AccountSyncer>;
  getAddressSyncer: () => Promise<AddressSyncer>;
  getBlockHashByHeight: (height: bigint) => Promise<string>;
  getCurrentBlockHeight: () => Promise<bigint>;
  getLatestBlock: () => Promise<{ height: bigint; timestamp: bigint }>;
  getLastFinalizedBlockHeight: () => Promise<bigint>;
  init: () => Promise<void>;
  registerDataDriver: (id: string, driver: any) => Promise<DataDriverRegistry>;
};

type NetworkStore = Readable<NetworkStoreContent> & NetworkStoreServices;

type NodeInfo = {
  bootstrappingNodes: Array<string>;
  chainId: number;
  kadcastAddress: string;
  version: string;
  versionBuild: string;
};

type WalletStoreBalance = {
  shielded: AddressBalance;
  unshielded: AccountBalance;
};

type WalletStoreContent = {
  balance: WalletStoreBalance;
  currentProfile: Profile | null;
  initialized: boolean;
  minimumStake: bigint;
  profiles: Array<Profile>;
  stakeInfo: StakeInfo;
  syncStatus: {
    from: bigint;
    isInProgress: boolean;
    last: bigint;
    error: Error | null;
    progress: number;
  };
  /** The open wallet's vault ID: "" for a wallet without a password. */
  walletKey: string;
  /** The wallets this tab unlocked, by number. */
  wallets: Array<{ key: string; n: number }>;
};

/** A wallet to open: its vault ID, number, and profile to show. */
type WalletToOpen = { key?: string; n?: number; profile?: number };

/** Throws WalletChangedError once the wallet it was taken for isn't open. */
type StillOpen = {
  (): void;
  <T>(value: T): T;
};

type HeldWallet = { n: number; profileGenerator: ProfileGenerator };

type WalletStoreServices = {
  abortSync: () => void;

  claimRewards: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  clearLocalData: () => Promise<void>;

  clearLocalDataAndInit: (
    profileGenerator: ProfileGenerator,
    syncFromBlock?: bigint,
    wallet?: WalletToOpen
  ) => Promise<void>;

  depositEvmFunctionCall: (
    address: `0x${string}`,
    amount: bigint,
    gas: Gas,
    options?: {
      extraData?: Uint8Array | number[];
      minGasLimit?: number;
    }
  ) => Promise<TransactionInfo>;

  /** Binds a screen's actions to the wallet open as it's drawn. */
  forThisWallet: () => <A extends unknown[], R>(
    task: (...args: A) => Promise<R>
  ) => (...args: A) => Promise<R>;

  getDuskEvmProofSubmitter: () => `0x${string}`;

  heldWallet: (key: string) => HeldWallet | null;

  holdWallet: (wallet: HeldWallet & { key: string }) => void;

  useContract: (contractId: string, wasmPath: string) => Promise<Contract>;

  /**
   * A check bound to the wallet open now: it throws WalletChangedError once
   * another wallet opened, or after a lock, and gives back what it's given.
   */
  whileOpen: () => StillOpen;

  init: (
    profileGenerator: ProfileGenerator,
    syncFromBlock?: bigint,
    wallet?: WalletToOpen
  ) => Promise<void>;

  open: (
    wallets: Array<HeldWallet & { key: string }>,
    options?: { active?: string; profile?: number }
  ) => Promise<void>;

  /** The balances and the stake read again, as after a send. */
  refreshBalance: () => Promise<void>;

  releaseWallet: (key: string) => void;

  reset: () => void;

  /**
   * Proves or claims a DuskEVM withdrawal: the Portal's call as
   * `@dusk-network/app-core/duskevm-withdrawals` gave it, signed as it is.
   */
  sendDuskEvmWithdrawalCall: (
    call: Readonly<{
      contractId: string;
      deposit: bigint;
      fnArgs: Uint8Array;
      fnName: string;
    }>,
    gas: Gas
  ) => Promise<TransactionInfo>;

  setCurrentProfile: (profile: Profile) => Promise<void>;

  shield: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  stake: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  /** Stakes `amount` with Sozu, through its pool `poolId`. */
  stakeWithSozu: (
    poolId: string,
    amount: bigint,
    gas: Gas
  ) => Promise<TransactionInfo>;

  /** The current profile's history, started on first use; none while it is turned off. */
  startHistory: () => import("$lib/activity").ActivitySession | null;

  switchWallet: (
    key: string,
    profile?: number,
    options?: { syncFromBlock?: bigint }
  ) => Promise<void>;

  /** Rejects on sync failure or cancellation; syncStatus also records current-session errors. */
  sync: (fromBlock?: bigint) => Promise<void>;

  /** `toName` is the `.dusk` name typed for `to`, kept in the history. */
  transfer: (
    to: string,
    amount: bigint,
    memo: string,
    gas: Gas,
    options?: { toName?: string }
  ) => Promise<TransactionInfo>;

  unshield: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  /** Adds `amount` to the stake there is. */
  topUpStake: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  unstake: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  /** Unstakes `amount` from Sozu, through its pool `poolId`. */
  unstakeFromSozu: (
    poolId: string,
    amount: bigint,
    gas: Gas
  ) => Promise<TransactionInfo>;
};

type WalletStore = Readable<WalletStoreContent> & WalletStoreServices;
