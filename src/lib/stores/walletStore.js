import { get, writable } from "svelte/store";
import { Bookkeeper, Bookmark, ProfileGenerator } from "@dusk/w3sper";
import {
  BRIDGE_FUNCTIONS,
  encodeDepositArgs,
  evmAddressOf,
} from "@dusk-network/networks/duskevm";

import { configuredBridge } from "$lib/bridge/bridgeCalls";
import {
  TX_KIND,
  activityFor,
  clearActivityStore,
  currentActivity,
  getShieldedHistory,
  isHistoryEnabled,
  stopActivity,
} from "$lib/activity";
import { closeContacts, openContacts } from "$lib/contacts";
import { forgetVerifiedNames } from "$lib/dusk-domains/verifiedNames";
import WalletChangedError from "$lib/errors/wallet-changed-error";
import { forgetRouteTransfers } from "$lib/bridge/migrationActivity";
import { SOZU_FN, sozuCall } from "@dusk-network/networks/sozu";
import { nodeBaseUrl } from "$lib/url";
import WalletTreasury from "$lib/wallet-treasury";
import { useWalletDataSuffix } from "$lib/wallets/dataNames";
import { profilesOf } from "$lib/wallets/profiles";
import { useWalletData } from "$lib/wallets/walletData";

import networkStore from "./networkStore";
import settingsStore from "./settingsStore";

const VITE_SYNC_INTERVAL = import.meta.env.VITE_SYNC_INTERVAL;
const AUTO_SYNC_INTERVAL = !isNaN(Number(VITE_SYNC_INTERVAL))
  ? Number(VITE_SYNC_INTERVAL)
  : 5 * 60 * 1000;

let autoSyncId = 0;

/** @type {AbortController | null} */
let syncController = null;

/** @type {Promise<void> | null} */
let syncPromise = null;

let walletSession = 0;

/** @type {WalletStoreContent} */
const initialState = {
  balance: {
    shielded: {
      spendable: 0n,
      value: 0n,
    },
    unshielded: {
      nonce: 0n,
      value: 0n,
    },
  },
  currentProfile: null,
  initialized: false,
  minimumStake: 0n,
  profiles: [],
  stakeInfo: {
    amount: null,
    faults: 0,
    hardFaults: 0,
    reward: 0n,
  },
  syncStatus: {
    error: null,
    from: 0n,
    isInProgress: false,
    last: 0n,
    progress: 0,
  },
  walletKey: "",
  wallets: [],
};

const walletStore = writable(initialState);

/**
 * The wallets this tab unlocked, by vault ID: what a switch opens, without
 * the password. A lock lets them all go.
 *
 * @type {Map<string, { n: number, profileGenerator: ProfileGenerator }>}
 */
const held = new Map();

/** The wallets held, by number, as the switcher lists them. */
const heldList = () =>
  [...held].map(([key, { n }]) => ({ key, n })).sort((a, b) => a.n - b.n);
const { set, subscribe, update } = walletStore;

const treasury = new WalletTreasury();
const bookkeeper = new Bookkeeper(treasury);

const getCurrentProfile = () => get(walletStore).currentProfile;

const getDuskEvmProofSubmitter = () =>
  /** @type {`0x${string}`} */ (
    evmAddressOf(String(unsafeGetCurrentProfile().account)).toLowerCase()
  );

function unsafeGetCurrentProfile() {
  const profile = getCurrentProfile();

  if (profile === null) {
    throw new TypeError("Can't retrieve profile: wallet not initialized");
  } else {
    return profile;
  }
}

function getBridgeContractId() {
  const { bridge } = configuredBridge();

  if (!bridge) {
    throw new Error("DuskEVM bridge contract id is not configured.");
  }

  return bridge;
}

/**
 * The history of the current profile's account, started on first use; none
 * while the history is turned off, when nothing about it runs or is kept.
 *
 * @param {Profile} profile
 * @returns {import("$lib/activity").ActivitySession | null}
 */
function historyOf(profile) {
  if (!isHistoryEnabled()) {
    return null;
  }

  const session = walletSession;
  const nodeUrl = nodeBaseUrl();

  return activityFor({
    account: String(profile.account),
    namesNetwork: get(networkStore).networkName,
    nodeUrl,
    profileIndex: +profile,
    shielded: () =>
      getShieldedHistory({
        isCurrent: () =>
          session === walletSession && getCurrentProfile() === profile,
        network: networkStore.connect,
        nodeUrl,
        profile,
        synced:
          !get(walletStore).syncStatus.isInProgress &&
          !get(walletStore).syncStatus.error,
      }),
  });
}

/**
 * Shows a transaction the wallet sent in the history until the archive has
 * it: in the history of the profile that sends it, taken as the send
 * begins, which keeps nothing after a reset since (activityStore's epoch).
 *
 * @param {Profile} profile
 * @param {SentDetails} details
 * @returns {(txInfo: TransactionInfo) => void}
 */
const recordInHistory = (profile, details) => {
  const history = historyOf(profile);

  return (txInfo) => {
    history?.recordSent({ ...details, hash: txInfo.hash }).catch(() => {});
  };
};

/**
 * Whether an address or account is the profile's own.
 *
 * @param {string} to
 * @param {Profile} profile
 */
const isOwn = (to, profile) =>
  to === String(profile.account) || to === String(profile.address);

/** @type {(txInfo: TransactionInfo) => void} */
const observeTxRemoval = (txInfo) => {
  networkStore.connect().then((network) =>
    network.transactions
      .withId(txInfo.hash)
      .once.removed()
      .then(() => sync())
      .catch(() => {}) // Background sync errors are reported in syncStatus.
      .finally(updateStaticInfo)
  );
};

/** @type {<T>(fn: (v: T) => any) => (a: T) => T} */
const passThruWithEffects = (fn) => (a) => {
  fn(a);

  return a;
};

/**
 * Keeps what a transaction changed in the cache until the sync sees it: the
 * notes it spent, or the nonce it used, so that a transaction made before
 * then isn't refused. Taken as the transaction begins: the nonce is the
 * sending profile's, and after a switch, a lock or a reset since, the cache
 * is left alone: the sync finds the transaction there.
 *
 * @param {Profile} profile
 * @returns {(txInfo: TransactionInfo) => Promise<TransactionInfo>}
 */
const updateCacheAfterTransaction = (profile) => {
  const session = walletSession;

  return async (txInfo) => {
    if (session !== walletSession) {
      return txInfo;
    }

    if ("nullifiers" in txInfo) {
      /**
       * For now we ignore the possible error while
       * writing the pending notes info, as we'll
       * change soon how they are handled (probably by w3sper directly).
       */
      await treasury
        .updateCachedPendingNotes(txInfo.nullifiers, txInfo.hash)
        .catch(() => {});
    } else {
      await treasury.updateCachedNonce(profile, txInfo.nonce);
    }

    return txInfo;
  };
};

/**
 * A transaction's builder whose transaction, once it's built and proved,
 * goes on only while the wallet it began on is open: the node gets it
 * after that check, or never.
 *
 * @template {object} B
 * @param {B} builder
 * @param {<T>(value: T) => T} stillOpen
 * @returns {B}
 */
const builtWhileOpen = (builder, stillOpen) =>
  new Proxy(builder, {
    get(target, property) {
      const value = Reflect.get(target, property);

      if (property === "build" && typeof value === "function") {
        return async (/** @type {unknown} */ network) =>
          stillOpen(await value.call(target, network));
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

/**
 * Sends a transaction as `profile`, taken once as the send begins: it is
 * built, kept in the cache and recorded in the history as that profile,
 * whichever one is chosen while the wallet syncs before it goes out. It
 * goes out only while the wallet it began on is open: not after a switch
 * or a lock since, checked once the wallet synced, and again once the
 * transaction is built and proved.
 *
 * @param {Profile} profile
 * @param {SentDetails} details What the history shows of it
 * @param {(network: Pick<import("@dusk/w3sper").Network, "execute">) => Promise<TransactionInfo>} execute
 * @returns {Promise<TransactionInfo>}
 */
const sendAs = (profile, details, execute) => {
  const stillOpen = whileOpen();
  const keepInCache = updateCacheAfterTransaction(profile);
  const record = recordInHistory(profile, details);

  /** @param {import("@dusk/w3sper").Network} network */
  const sending = (network) => ({
    /** @param {any} tx */
    execute: (tx) => network.execute(builtWhileOpen(tx, stillOpen)),
  });

  return sync()
    .catch((error) => {
      throw stillOpen(error);
    })
    .then(networkStore.connect)
    .then((network) => execute(sending(stillOpen(network))))
    .then(keepInCache)
    .then(passThruWithEffects(observeTxRemoval))
    .then(passThruWithEffects(record));
};

/** @type {() => Promise<void>} */
const updateBalance = async () => {
  const session = walletSession;
  const profile = getCurrentProfile();

  if (!profile) {
    return;
  }

  const shielded = /** @type {AddressBalance} */ (
    await bookkeeper.balance(profile.address)
  );
  const unshielded = /** @type {AccountBalance} */ (
    await bookkeeper.balance(profile.account)
  );
  const balance = { shielded, unshielded };

  /**
   * We ignore the error as the cached balance is only
   * a nice to have for the user.
   */
  if (session !== walletSession || profile !== getCurrentProfile()) {
    return;
  }
  await treasury.setCachedBalance(profile, balance).catch(() => {});

  if (session !== walletSession || profile !== getCurrentProfile()) {
    return;
  }
  update((currentStore) => ({
    ...currentStore,
    balance,
  }));
};

/** @type {() => Promise<void>} */
const updateStakeInfo = async () => {
  const session = walletSession;
  const profile = getCurrentProfile();

  if (!profile) {
    return;
  }

  /** @type {StakeInfo} */
  const stakeInfo = await bookkeeper.stakeInfo(profile.account);

  /**
   * We ignore the error as the cached stake info is only
   * a nice to have for the user.
   */
  if (session !== walletSession || profile !== getCurrentProfile()) {
    return;
  }
  await treasury.setCachedStakeInfo(profile, stakeInfo).catch(() => {});

  if (session !== walletSession || profile !== getCurrentProfile()) {
    return;
  }
  update((currentStore) => ({
    ...currentStore,
    stakeInfo,
  }));
};

const updateStaticInfo = () =>
  Promise.allSettled([updateBalance(), updateStakeInfo()]);

/**
 * The automatic sync that came due while the page was hidden: it waits for
 * the page to show again.
 *
 * @type {(() => void) | null}
 */
let syncWhenShown = null;

function cancelSyncWhenShown() {
  if (syncWhenShown) {
    document.removeEventListener("visibilitychange", syncWhenShown);
    syncWhenShown = null;
  }
}

/**
 * The automatic sync: now, or, while the page is hidden, once it shows
 * again.
 */
function autoSync() {
  cancelSyncWhenShown();

  if (document.visibilityState === "hidden") {
    syncWhenShown = () => {
      if (document.visibilityState !== "hidden") {
        autoSync();
      }
    };
    document.addEventListener("visibilitychange", syncWhenShown);

    return;
  }

  sync()
    .catch(() => {})
    .finally(updateStaticInfo);
}

/** @type {WalletStoreServices["abortSync"]} */
const abortSync = () => {
  window.clearTimeout(autoSyncId);
  cancelSyncWhenShown();
  syncController?.abort();
  syncPromise = null;
};

/** @type {WalletStoreServices["clearLocalData"]} */
const clearLocalData = async () => {
  abortSync();
  forgetVerifiedNames();
  forgetRouteTransfers();
  stopActivity();

  await treasury.clearCache();
  await clearActivityStore();
};

/** @type {WalletStoreServices["clearLocalDataAndInit"]} */
const clearLocalDataAndInit = async (
  profileGenerator,
  syncFromBlock,
  wallet
) => {
  reset();
  const session = walletSession;
  await clearLocalData();

  if (session === walletSession) {
    await init(profileGenerator, syncFromBlock, wallet);
  }
};

/** @type {WalletStoreServices["claimRewards"]} */
const claimRewards = async (amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: "in",
      kind: TX_KIND.WITHDRAW_REWARD,
      privacy: "public",
    },
    (network) =>
      network.execute(bookkeeper.as(profile).withdraw(amount).gas(gas))
  );
};

/** @type {WalletStoreServices["startHistory"]} */
const startHistory = () => historyOf(unsafeGetCurrentProfile());

/**
 * Opens the wallet's contacts with the key its seed makes: they stay
 * closed when there's none.
 *
 * @param {ProfileGenerator} profileGenerator
 * @param {Profile} firstProfile
 */
async function openContactsOf(profileGenerator, firstProfile) {
  try {
    const seed = await ProfileGenerator.seedFrom(profileGenerator);

    await openContacts({
      account: String(firstProfile.account),
      seed: seed ?? new Uint8Array(),
    });
  } catch {
    // The contacts stay closed, as when the wallet is locked.
  }
}

/** @type {WalletStoreServices["init"]} */
async function init(
  profileGeneratorInstance,
  syncFromBlock,
  { key = "", n = 1, profile = 0 } = {}
) {
  resetSession();
  const session = walletSession;

  held.set(key, { n, profileGenerator: profileGeneratorInstance });

  // Its own cache, records and names from now on.
  useWalletData(key);

  // Two profiles by default: the same two each time the wallet opens.
  const profiles = await profilesOf(profileGeneratorInstance);
  const currentProfile = profiles[profile] ?? profiles[0];

  // The contacts open with the wallet, and close when it locks.
  if (session === walletSession) {
    await openContactsOf(profileGeneratorInstance, profiles[0]);
  }

  const [balance, stakeInfo, minimumStake] = await Promise.all([
    treasury.getCachedBalance(currentProfile),
    treasury.getCachedStakeInfo(currentProfile),
    bookkeeper.minimumStake,
  ]);

  if (session !== walletSession) {
    return;
  }

  treasury.setProfiles(profiles);

  set({
    ...initialState,
    balance,
    currentProfile,
    initialized: true,
    minimumStake,
    profiles,
    stakeInfo,
    walletKey: key,
    wallets: heldList(),
  });

  sync(syncFromBlock)
    // Keep the initialized wallet identity even if its background sync fails.
    .catch(() => {})
    .then(() => {
      // The wallet set up here, the first time it syncs: unlocking and
      // switching keep the one there is.
      if (session === walletSession) {
        settingsStore.update((settings) =>
          settings.userId
            ? settings
            : { ...settings, userId: profiles[0].address.toString() }
        );
      }
    })
    .finally(async () => {
      if (session === walletSession) {
        await updateStaticInfo();
      }
    });
}

/**
 * Opens the wallets the password opened, all held from now on: `active`,
 * at its profile `profile`, or the first by number.
 *
 * @type {WalletStoreServices["open"]}
 */
async function open(wallets, { active, profile = 0 } = {}) {
  reset();

  for (const { key, n, profileGenerator } of wallets) {
    held.set(key, { n, profileGenerator });
  }

  const [first] = heldList();
  const key = active && held.has(active) ? active : first?.key;
  const wallet = key === undefined ? undefined : held.get(key);

  if (key === undefined || !wallet) {
    throw new Error("No wallet to open");
  }

  await init(wallet.profileGenerator, undefined, { key, n: wallet.n, profile });
}

/**
 * Another wallet held here, without the password, at its profile
 * `profile`; in the wallet open, its profile `profile`.
 *
 * @type {WalletStoreServices["switchWallet"]}
 */
async function switchWallet(key, profile = 0, { syncFromBlock } = {}) {
  const store = get(walletStore);

  if (store.initialized && key === store.walletKey) {
    return setCurrentProfile(store.profiles[profile] ?? store.profiles[0]);
  }

  const wallet = held.get(key);

  if (!wallet) {
    throw new Error("That wallet isn't open here. Lock, then unlock again.");
  }

  return init(wallet.profileGenerator, syncFromBlock, {
    key,
    n: wallet.n,
    profile,
  });
}

/**
 * Holds another wallet here, as it's added: a switch opens it.
 *
 * @type {WalletStoreServices["holdWallet"]}
 */
function holdWallet({ key, n, profileGenerator }) {
  held.set(key, { n, profileGenerator });
  update((store) => ({ ...store, wallets: heldList() }));
}

/**
 * Lets a removed wallet go: it's no longer listed, and no switch opens it.
 *
 * @type {WalletStoreServices["releaseWallet"]}
 */
function releaseWallet(key) {
  held.delete(key);
  update((store) => ({ ...store, wallets: heldList() }));
}

/**
 * A wallet held here, by vault ID: its number and its profiles' generator.
 *
 * @type {WalletStoreServices["heldWallet"]}
 */
const heldWallet = (key) => held.get(key) ?? null;

/**
 * A check bound to the wallet open now, for work that acts for it after it
 * waits, right before it acts: once another wallet opened, or after a
 * lock, it throws WalletChangedError; otherwise it gives back what it's
 * given.
 *
 * @type {WalletStoreServices["whileOpen"]}
 */
function whileOpen() {
  const session = walletSession;

  /** @type {any} */
  const stillOpen = (/** @type {unknown} */ value) => {
    if (session !== walletSession) {
      throw new WalletChangedError();
    }

    return value;
  };

  return stillOpen;
}

/**
 * What a screen does, bound to the wallet open as it's drawn: asked once
 * another opened, or after a lock, it does nothing and says so
 * (WalletChangedError).
 *
 * @type {WalletStoreServices["forThisWallet"]}
 */
function forThisWallet() {
  const stillOpen = whileOpen();

  return (task) =>
    (...args) => {
      try {
        stillOpen();
      } catch (error) {
        return Promise.reject(error);
      }

      return task(...args);
    };
}

/**
 * The balances and the stake read again, as after a transaction of the
 * wallet's: for one the history found that changed them.
 *
 * @type {WalletStoreServices["refreshBalance"]}
 */
const refreshBalance = () =>
  sync()
    .catch(() => {}) // Background sync errors are reported in syncStatus.
    .finally(updateStaticInfo)
    .then(() => {});

/**
 * Ends what the wallet open did: its sync, history, contacts and work under
 * way. What it shows stays until the next wallet's is set.
 */
function resetSession() {
  walletSession++;
  abortSync();
  stopActivity();
  closeContacts();
  treasury.reset();
}

/**
 * Locks: every wallet held here let go, and nothing of them shown.
 *
 * @type {WalletStoreServices["reset"]}
 */
function reset() {
  held.clear();
  resetSession();

  // No wallet open: the names of before, until one opens.
  useWalletDataSuffix("", "", false);
  set(initialState);
}

/** @type {WalletStoreServices["setCurrentProfile"]} */
async function setCurrentProfile(profile) {
  const store = get(walletStore);

  return store.profiles.includes(profile)
    ? Promise.resolve(set({ ...store, currentProfile: profile })).then(
        async () => {
          await updateStaticInfo();
        }
      )
    : Promise.reject(
        new Error("The received profile is not in the known list")
      );
}

/** @type {WalletStoreServices["shield"]} */
const shield = async (amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: "out",
      kind: TX_KIND.SHIELD,
      privacy: "public",
    },
    (network) => network.execute(bookkeeper.as(profile).shield(amount).gas(gas))
  );
};

/** @type {WalletStoreServices["stake"]} */
const stake = async (amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: "out",
      kind: TX_KIND.STAKE,
      privacy: "public",
    },
    (network) => network.execute(bookkeeper.as(profile).stake(amount).gas(gas))
  );
};

/**
 * Calls Sozu's pool from the current profile's public account: a stake
 * sends the amount to the pool, an unstake asks for it back.
 *
 * @param {string} poolId
 * @param {typeof SOZU_FN[keyof typeof SOZU_FN]} fnName
 * @param {bigint} amount
 * @param {Gas} gas
 * @returns {Promise<TransactionInfo>}
 */
const callSozu = async (poolId, fnName, amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      contractId: poolId,
      direction: fnName === SOZU_FN.STAKE ? "out" : "in",
      fnName,
      kind: TX_KIND.CONTRACT_CALL,
      privacy: "public",
    },
    async (network) => {
      const { contractId, deposit, fnArgs } = sozuCall(poolId, fnName, amount);
      const builder = /** @type {any} */ (
        bookkeeper.as(profile).transfer(0n)
      ).payload({
        contractId: Array.from(contractId.match(/../g) ?? [], (byte) =>
          parseInt(byte, 16)
        ),
        fnArgs,
        fnName,
      });

      return await network.execute(
        builder.to(profile.account).deposit(deposit).gas(gas)
      );
    }
  );
};

/** @type {WalletStoreServices["stakeWithSozu"]} */
const stakeWithSozu = (poolId, amount, gas) =>
  callSozu(poolId, SOZU_FN.STAKE, amount, gas);

/** @type {WalletStoreServices["unstakeFromSozu"]} */
const unstakeFromSozu = (poolId, amount, gas) =>
  callSozu(poolId, SOZU_FN.UNSTAKE, amount, gas);

/** @type {WalletStoreServices["topUpStake"]} */
const topUpStake = async (amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: "out",
      kind: TX_KIND.STAKE,
      privacy: "public",
    },
    (network) => network.execute(bookkeeper.as(profile).topup(amount).gas(gas))
  );
};

/** @type {WalletStoreServices["sync"]} */
async function sync(fromBlock) {
  const session = walletSession;
  const store = get(walletStore);

  if (!store.initialized) {
    throw new Error(
      "The wallet store needs to be initialized with a profile generator"
    );
  }

  if (!syncPromise) {
    set({
      ...store,
      syncStatus: {
        error: null,
        from: 0n,
        isInProgress: true,
        last: 0n,
        progress: 0,
      },
    });

    const controller = new AbortController();
    syncController = controller;
    const ensureCurrent = () => {
      if (session !== walletSession || controller.signal.aborted) {
        throw new Error("Synchronization aborted");
      }
    };

    const currentSyncPromise = (async () => {
      const { block, bookmark, lastFinalizedBlockHeight } =
        await treasury.getCachedSyncInfo();

      /** @type {bigint | Bookmark} */
      let from;

      /*
       * Unless the user wants to sync from a specific block height,
       * we try to restart from the last stored bookmark.
       * Before doing that we compare the block hash we have in cache
       * with the hash at the same block height on the network: if
       * they don't match then a block has been rejected, we can't
       * use our bookmark, and our only safe option is to restart
       * from the last finalized block we have cached.
       */
      if (fromBlock !== undefined) {
        from = fromBlock;
      } else {
        const isLocalCacheValid = await networkStore
          .checkBlock(block.height, block.hash)
          .catch(() => false);

        from = isLocalCacheValid
          ? Bookmark.from(bookmark)
          : lastFinalizedBlockHeight;
      }

      ensureCurrent();
      if (from === 0n) {
        await treasury.clearCache();
      }
      ensureCurrent();

      update((currentStore) => ({
        ...currentStore,
        syncStatus: {
          ...currentStore.syncStatus,
          from: from instanceof Bookmark ? block.height : from,
        },
      }));

      /** @type {(evt: CustomEvent) => void} */
      const syncIterationListener = ({ detail }) => {
        if (session !== walletSession) {
          return;
        }

        update((currentStore) => ({
          ...currentStore,
          syncStatus: {
            ...currentStore.syncStatus,
            last: detail.blocks.last,
            progress: detail.progress,
          },
        }));
      };

      await treasury.update(from, syncIterationListener, controller.signal);
    })()
      .then(ensureCurrent)
      .then(() => {
        if (session !== walletSession) {
          return;
        }

        update((currentStore) => ({
          ...currentStore,
          syncStatus: initialState.syncStatus,
        }));

        // The notes are synced: the history can have the shielded side now.
        currentActivity()?.notesSynced();
      })
      .then(() => {
        if (session !== walletSession) {
          return;
        }

        window.clearTimeout(autoSyncId);
        cancelSyncWhenShown();
        autoSyncId = window.setTimeout(autoSync, AUTO_SYNC_INTERVAL);
      })
      .catch((error) => {
        controller.abort();

        if (session === walletSession && syncController === controller) {
          update((currentStore) => ({
            ...currentStore,
            syncStatus: {
              error,
              from: 0n,
              isInProgress: false,
              last: 0n,
              progress: 0,
            },
          }));
        }

        // Transaction callers must not proceed after a failed or stale sync.
        throw error;
      })
      .finally(() => {
        if (syncPromise === currentSyncPromise) {
          syncPromise = null;
        }

        if (syncController === controller) {
          syncController = null;
        }
      });

    syncPromise = currentSyncPromise;
  }

  await syncPromise;
}

/** @type {WalletStoreServices["transfer"]} */
const transfer = async (to, amount, memo, gas, { toName } = {}) => {
  const profile = unsafeGetCurrentProfile();
  const isShielded = ProfileGenerator.typeOf(to) === "address";

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: isOwn(to, profile) ? "self" : "out",
      kind: TX_KIND.TRANSFER,
      memo: memo || undefined,
      privacy: isShielded ? "shielded" : "public",
      to,
      toName: toName || undefined,
    },
    async (network) => {
      const tx = bookkeeper
        .as(profile)
        .transfer(amount)
        .to(to)
        .memo(memo)
        .gas(gas);

      if (isShielded) {
        // @ts-ignore
        tx.obfuscated();
      }

      return await network.execute(tx);
    }
  );
};

/** @type {WalletStoreServices["depositEvmFunctionCall"]} */
const depositEvmFunctionCall = async (
  address,
  amount,
  gas,
  { extraData, minGasLimit } = {}
) => {
  const bridgeContractId = getBridgeContractId();
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      bridge: { amount: String(amount), kind: "deposit", to: address },
      contractId: bridgeContractId,
      direction: "out",
      fnName: BRIDGE_FUNCTIONS.deposit,
      kind: TX_KIND.CONTRACT_CALL,
      privacy: "public",
    },
    async (network) => {
      const payload = {
        contractId: Array.from(bridgeContractId.match(/../g) ?? [], (byte) =>
          parseInt(byte, 16)
        ),
        fnArgs: encodeDepositArgs({
          amountLux: amount,
          extraData,
          minGasLimit,
          to: address,
        }),
        fnName: BRIDGE_FUNCTIONS.deposit,
      };
      const builder = /** @type {any} */ (
        bookkeeper.as(profile).transfer(0n)
      ).payload(payload);

      return await network.execute(
        builder.to(profile.account).deposit(BigInt(amount)).gas(gas)
      );
    }
  );
};

/** @type {WalletStoreServices["unshield"]} */
const unshield = async (amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: "in",
      kind: TX_KIND.UNSHIELD,
      privacy: "shielded",
    },
    (network) =>
      network.execute(bookkeeper.as(profile).unshield(amount).gas(gas))
  );
};

/** @type {WalletStoreServices["unstake"]} */
const unstake = async (amount, gas) => {
  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: String(amount),
      direction: "in",
      kind: TX_KIND.UNSTAKE,
      privacy: "public",
    },
    (network) =>
      network.execute(bookkeeper.as(profile).unstake(amount).gas(gas))
  );
};

/** @type {WalletStoreServices["useContract"]} */
const useContract = async (contractId, wasmPath) =>
  networkStore.connect().then(async (network) => {
    network.dataDrivers.register(contractId, () =>
      fetch(wasmPath).then((r) => r.arrayBuffer())
    );

    const profile = unsafeGetCurrentProfile();
    const bookentry = bookkeeper.as(profile);
    const contract = bookentry.contract(contractId, network);

    return contract;
  });

/**
 * Proves or claims a DuskEVM withdrawal on Dusk: the Portal's call as the
 * withdrawals' package gave it, its arguments signed as they were encoded
 * and read back, from the account to itself, with no DUSK sent along.
 *
 * @type {WalletStoreServices["sendDuskEvmWithdrawalCall"]}
 */
const sendDuskEvmWithdrawalCall = async (
  { contractId, deposit, fnArgs, fnName },
  gas
) => {
  if (deposit !== 0n || !/^[0-9a-f]{64}$/.test(contractId)) {
    throw new Error("Not a DuskEVM withdrawal's proof or claim.");
  }

  const profile = unsafeGetCurrentProfile();

  return sendAs(
    profile,
    {
      amount: "0",
      contractId,
      direction: "out",
      fnName,
      kind: TX_KIND.CONTRACT_CALL,
      privacy: "public",
    },
    async (network) => {
      const payload = {
        contractId: Array.from(contractId.match(/../g) ?? [], (byte) =>
          parseInt(byte, 16)
        ),
        fnArgs,
        fnName,
      };
      const builder = /** @type {any} */ (
        bookkeeper.as(profile).transfer(0n)
      ).payload(payload);

      return await network.execute(
        builder.to(profile.account).deposit(deposit).gas(gas)
      );
    }
  );
};

/** @type {WalletStore} */
export default {
  abortSync,
  claimRewards,
  clearLocalData,
  clearLocalDataAndInit,
  depositEvmFunctionCall,
  forThisWallet,
  getDuskEvmProofSubmitter,
  heldWallet,
  holdWallet,
  init,
  open,
  refreshBalance,
  releaseWallet,
  reset,
  sendDuskEvmWithdrawalCall,
  setCurrentProfile,
  shield,
  stake,
  stakeWithSozu,
  startHistory,
  subscribe,
  switchWallet,
  sync,
  topUpStake,
  transfer,
  unshield,
  unstake,
  unstakeFromSozu,
  useContract,
  whileOpen,
};
