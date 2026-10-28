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
  get connected(): boolean;
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
};

type WalletStoreServices = {
  abortSync: () => void;

  claimRewards: (amount: bigint, gas: Gas) => Promise<TransactionInfo>;

  clearLocalData: () => Promise<void>;

  clearLocalDataAndInit: (
    profileGenerator: ProfileGenerator,
    syncFromBlock?: bigint
  ) => Promise<void>;

  depositEvmFunctionCall: (
    address: `0x${string}`,
    amount: bigint,
    gas: Gas,
    options?: {
      extraData?: Uint8Array | ArrayBuffer | number[];
      minGasLimit?: number;
    }
  ) => Promise<TransactionInfo>;

  finalizeDuskEvmWithdrawal: (
    contractId: string,
    wasmPath: string,
    withdrawal: unknown,
    gas?: Gas
  ) => Promise<TransactionInfo>;

  getDuskEvmProofSubmitter: () => `0x${string}`;

  proveDuskEvmWithdrawal: (
    contractId: string,
    wasmPath: string,
    args: unknown,
    gas?: Gas
  ) => Promise<TransactionInfo>;

  useContract: (contractId: string, wasmPath: string) => Promise<Contract>;

  init: (
    profileGenerator: ProfileGenerator,
    syncFromBlock?: bigint
  ) => Promise<void>;

  reset: () => void;

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
