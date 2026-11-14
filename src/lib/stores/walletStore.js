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
  activityState,
  awaitArrival,
  clearActivityStore,
  currentActivity,
  forgetArrivals,
  forgetWalletActivity,
  getShieldedHistory,
  isHistoryEnabled,
  isToAnotherProfile,
  noteSentOutcome,
  stopActivity,
} from "$lib/activity";
import { closeContacts, openContacts } from "$lib/contacts";
import { forgetVerifiedNames } from "$lib/dusk-domains/verifiedNames";
import WalletChangedError from "$lib/errors/wallet-changed-error";
import { forgetRouteTransfers } from "$lib/bridge/migrationActivity";
import { SOZU_FN, sozuCall } from "@dusk-network/networks/sozu";
import {
  cancelSendPassword,
  sendPasswordFor,
} from "$lib/security/sendPassword";
import { unconfirmedHash } from "$lib/transactions/describeFailure";
import { outcomeUnknown } from "$lib/transactions/outcomeUnknown";
import transactionInBlock from "$lib/transactions/transactionInBlock";
import { cancelWaitingSends } from "$lib/transactions/waitingSends";
import { nodeBaseUrl } from "$lib/url";
import WalletTreasury from "$lib/wallet-treasury";
import { useWalletDataSuffix } from "$lib/wallets/dataNames";
import { tellOtherTabs } from "$lib/wallets/tabs";
import { profilesOf } from "$lib/wallets/profiles";
import { useWalletData } from "$lib/wallets/walletData";

import networkReach from "./networkReach";
import networkStore from "./networkStore";
import settingsStore from "./settingsStore";

const VITE_SYNC_INTERVAL = import.meta.env.VITE_SYNC_INTERVAL;
const AUTO_SYNC_INTERVAL = !isNaN(Number(VITE_SYNC_INTERVAL))
  ? Number(VITE_SYNC_INTERVAL)
  : 5 * 60 * 1000;

/**
 * How soon a sync that failed is tried again, in milliseconds, while the page
 * shows: as the welcome screen tries to connect again.
 */
const RETRY_AFTER_FAILURE = 10_000;

let autoSyncId = 0;

/** @type {AbortController | null} */
let syncController = null;

/** @type {Promise<void> | null} */
let syncPromise = null;

/** How many syncs started: the number of the one running, or the last. */
let syncNumber = 0;

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
  balanceRead: false,
  balanceReadFailed: false,
  currentProfile: null,
  initialized: false,
  minimumStake: 0n,
  pendingStakes: [],
  profiles: [],
  stakeInfo: {
    amount: null,
    faults: 0,
    hardFaults: 0,
    reward: 0n,
  },
  stakeReadFailed: false,
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
 * it, once (`record`): in the history of the profile that sends it, taken as
 * the send begins, which keeps nothing after a reset since (activityStore's
 * epoch). One the node refused as it was asked to broadcast it went nowhere,
 * and goes from it again (`forget`), once it's in it.
 *
 * @param {Profile} profile
 * @param {SentDetails} details
 * @returns {{ forget: (txInfo: TransactionInfo) => void, record: (txInfo: TransactionInfo) => void }}
 */
const recordInHistory = (profile, details) => {
  const history = historyOf(profile);

  /** The transactions recorded, and how far their records got, by hash. */
  const recorded = new Map();

  /** @param {() => Promise<void> | undefined} change */
  const tellTabs = (change) =>
    Promise.resolve()
      .then(change)
      // The other tabs' history shows it too.
      .then(() => tellOtherTabs({ type: "sent" }))
      .catch(() => {});

  return {
    forget({ hash }) {
      const record = recorded.get(hash);

      if (record) {
        recorded.delete(hash);
        void record.then(() => tellTabs(() => history?.forgetSent(hash)));
      }
    },
    record({ hash }) {
      if (!recorded.has(hash)) {
        recorded.set(
          hash,
          tellTabs(() => history?.recordSent({ ...details, hash }))
        );
      }
    },
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

/**
 * A payment `profile` sends to another profile here is looked for in that
 * profile's history once it goes out, and its requests say they're checking
 * until it shows ($lib/activity/arrivals). Taken as the send begins.
 *
 * @param {Profile} profile
 * @param {SentDetails} details
 * @returns {(txInfo: TransactionInfo) => void}
 */
const lookForArrival = (profile, { to }) => {
  const isToAnother = isToAnotherProfile(
    to,
    profile,
    get(walletStore).profiles
  );

  return (txInfo) => {
    if (isToAnother) {
      awaitArrival({ hash: txInfo.hash, to: String(to) });
    }
  };
};

/**
 * A sync that started after the `after`-th, ended: the one running if it
 * did, or else one more, once that one ends. What it reads is what the
 * node had after the `after`-th started, as after a transaction sent then.
 *
 * @param {number} after
 * @returns {Promise<void>}
 */
async function syncAfter(after) {
  const joined = syncPromise ? syncNumber : syncNumber + 1;

  await sync();

  if (joined <= after) {
    await sync();
  }
}

/**
 * Once the node takes a transaction out of its queue: what's to forget of it
 * then, a sync that started after it was sent, and the balances and the
 * stake read again. It rejects when the queue can't be followed, or that
 * sync fails: the balances and the stake are read all the same, as they
 * were.
 *
 * @param {TransactionInfo} txInfo
 * @param {number} after The number of the last sync started as it was sent
 * @param {() => void} [onRemoved]
 * @returns {Promise<void>}
 */
const refreshOnRemoval = (txInfo, after, onRemoved) =>
  networkStore
    .connect()
    .then((network) => network.transactions.withId(txInfo.hash).once.removed())
    .then(() => {
      onRemoved?.();

      return syncAfter(after);
    })
    .finally(updateStaticInfo);

/**
 * Holds Staking's buttons for a staking transaction `profile` sent, until
 * a sync that started after it was sent read the stake again: once the
 * node took it out of its queue (`refreshed`), or else at each automatic
 * sync's interval, a sync the hold starts and waits for. Not when the
 * queue can't be followed, nor when the sync fails: the stake read then is
 * the one from before. Also once the history has it from a block, after a
 * sync that started then read the stake. After two intervals without one, the buttons come
 * back all the same, the stake said to be maybe out of date (`stale`)
 * until it's read.
 *
 * @param {Profile} profile
 * @param {string} hash
 * @param {number} after The number of the last sync started as it was sent
 * @param {Promise<unknown>} refreshed
 */
function holdStaking(profile, hash, after, refreshed) {
  const session = walletSession;
  let isDone = false;
  let refreshId = 0;

  const isCurrent = () => !isDone && session === walletSession;
  const txHash = hash.toLowerCase();
  let isInBlock = false;

  /** @type {() => void} */
  let stopWatching = () => {};

  /**
   * @param {(stakes: WalletStoreContent["pendingStakes"]) => WalletStoreContent["pendingStakes"]} change
   */
  const changeStakes = (change) =>
    update((store) => ({
      ...store,
      pendingStakes: change(store.pendingStakes),
    }));

  const release = () => {
    if (isCurrent()) {
      isDone = true;
      window.clearTimeout(refreshId);
      window.clearTimeout(deadlineId);
      stopWatching();
      changeStakes((stakes) => stakes.filter((sent) => sent.hash !== hash));
    }
  };

  const refresh = () => {
    if (isCurrent()) {
      syncAfter(after)
        .then(updateStaticInfo)
        .then(release, () => {
          if (isCurrent()) {
            refreshId = window.setTimeout(refresh, AUTO_SYNC_INTERVAL);
          }
        });
    }
  };

  const deadlineId = window.setTimeout(() => {
    if (isCurrent()) {
      changeStakes((stakes) =>
        stakes.map((sent) =>
          sent.hash === hash ? { ...sent, stale: true } : sent
        )
      );
    }
  }, 2 * AUTO_SYNC_INTERVAL);

  refreshId = window.setTimeout(refresh, AUTO_SYNC_INTERVAL);
  changeStakes((stakes) => [
    ...stakes,
    { account: String(profile.account), hash },
  ]);
  refreshed.then(release, () => {});

  // The history has it from a block: it left the queue, said so or not.
  stopWatching = activityState.subscribe(({ rows }) => {
    if (!isCurrent()) {
      stopWatching();
    } else if (
      !isInBlock &&
      rows.some((row) => row.hash === txHash && row.source !== "sent")
    ) {
      isInBlock = true;
      // The stake is read from what the wallet synced: a sync from now.
      syncAfter(syncNumber)
        .then(updateStaticInfo)
        .then(([, stake]) => {
          if (stake.status !== "fulfilled") {
            throw stake.reason;
          }

          release();
        })
        .catch(() => {
          isInBlock = false;
        });
    }
  });
}

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
      // It went out: a failure to keep its nonce mustn't say it didn't.
      await treasury.updateCachedNonce(profile, txInfo.nonce).catch((error) => {
        throw outcomeUnknown(error);
      });
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
 * The sends of the wallet open, one at a time: each is built, checked by the
 * node, handed over to it and its nonce or notes kept before the next is
 * built, as two built at once take the same nonce, or the same notes, as two
 * that waited for the network would as it answers.
 */
let sendsInTurn = Promise.resolve();

/**
 * Does `work` in its turn, once the sends before it are over. Its turn is
 * over once it is, or as it's called off with `gate`, as then it never
 * reaches the node.
 *
 * @template T
 * @param {() => Promise<T>} work
 * @param {import("$lib/transactions/sendGate").SendGate} [gate]
 * @returns {Promise<T>}
 */
function inTurn(work, gate) {
  const turn = sendsInTurn.then(() =>
    gate ? Promise.race([work(), gate.cancelled]) : work()
  );

  sendsInTurn = turn.then(
    () => {},
    () => {}
  );

  return turn;
}

/**
 * Sends a transaction as `profile`, taken once as the send begins: it is
 * built, kept in the cache and recorded in the history as that profile,
 * whichever one is chosen while the wallet syncs before it goes out. It
 * goes out only while the wallet it began on is open: not after a switch
 * or a lock since, checked once the wallet synced, and again once the
 * transaction is built and proved. A staking transaction holds Staking's
 * buttons until it settles. Every transaction of the wallet's comes this way:
 * what it moves out (`moves`, none for what comes back to the public balance)
 * and the most its gas costs ask for the password first, above the amount
 * chosen in Settings. One handed over whose answer got lost may have gone
 * out: History shows it on its way at once, and it's followed as one that
 * went out, as the chain will say. With a `gate`, it can be called off until
 * the node is asked to broadcast it: it then stops at once, whatever it
 * waits on, and never reaches the node (sendGate). Until then, what couldn't
 * reach the network waits for it, and is made again once it answers.
 *
 * @param {Profile} profile
 * @param {SentDetails} details What the history shows of it
 * @param {(network: Pick<import("@dusk/w3sper").Network, "execute">) => Promise<TransactionInfo>} execute
 * @param {{ gas: Gas, gate?: import("$lib/transactions/sendGate").SendGate, moves?: bigint, staking?: boolean }} options
 * @returns {Promise<TransactionInfo>}
 */
const sendAs = (
  profile,
  details,
  execute,
  { gas, gate, moves = 0n, staking = false }
) => {
  const session = walletSession;
  const stillOpen = whileOpen();
  const keepInCache = updateCacheAfterTransaction(profile);
  const { forget, record } = recordInHistory(profile, details);
  const lookFor = lookForArrival(profile, details);

  /** The hash of the transaction the node was asked to broadcast, if any. */
  let handedOver = "";

  /** @param {import("@dusk/w3sper").Network} network */
  const sending = (network) => ({
    /** @param {any} tx */
    execute: (tx) =>
      /** @type {import("$lib/transactions/SendingNetwork").default} */ (
        network
      ).execute(builtWhileOpen(tx, stillOpen), {
        gate,
        // It may go out from now on: History shows it on its way at once,
        // also where the node's answer never comes.
        onHandOver: (hash) => {
          handedOver = hash;
          record(/** @type {TransactionInfo} */ ({ hash }));
        },
      }),
  });

  /**
   * History says what the block that took it says, as the balances read
   * from then do, not once that block is final: true once it's said, false
   * where no block has it, or another wallet opened.
   *
   * @param {TransactionInfo} txInfo
   * @returns {Promise<boolean>}
   */
  const sayInBlock = (txInfo) =>
    networkStore
      .connect()
      .then((network) => transactionInBlock(network, txInfo.hash))
      .then(async (inBlock) => {
        if (!inBlock || session !== walletSession) {
          return false;
        }

        await noteSentOutcome(txInfo.hash, inBlock);

        return true;
      })
      .catch(() => false);

  /** @param {TransactionInfo} txInfo */
  const followRemoval = (txInfo) => {
    const after = syncNumber;

    /** Whether History said it as it left the node's queue: not yet. */
    let saidInBlock = Promise.resolve(true);

    // Its nonce, kept for the next to take the one after, goes with it: not
    // once another wallet opened, or after a lock, as the nonce kept then is
    // another send's.
    const refreshed = refreshOnRemoval(txInfo, after, () => {
      if ("nonce" in txInfo && session === walletSession) {
        treasury.forgetSentNonce(profile, txInfo.nonce);
      }

      // Out of the node's queue: History says it as the balances read now.
      saidInBlock = sayInBlock(txInfo);
    });

    // Background sync errors are reported in syncStatus. A block the node
    // didn't have yet as it took it out of its queue, it has once the
    // balances are read.
    refreshed
      .catch(() => {})
      .then(() => saidInBlock)
      .then((isSaid) => isSaid || sayInBlock(txInfo));

    if (staking) {
      holdStaking(profile, txInfo.hash, after, refreshed);
    }
  };

  const password = sendPasswordFor(
    moves + gas.total,
    get(walletStore).walletKey
  );

  /**
   * Synced, connected, built and checked by the node, then handed over to
   * it, which may answer, and what it changed kept, in its turn.
   *
   * @returns {Promise<TransactionInfo>}
   */
  const attempt = () =>
    sync()
      .catch((error) => {
        throw stillOpen(error);
      })
      .then(() => {
        gate?.check();

        return networkStore.connect();
      })
      .then((network) =>
        inTurn(() => {
          gate?.check();

          return execute(sending(stillOpen(network))).then((txInfo) =>
            // It went out: what goes wrong from here doesn't say it didn't.
            keepInCache(txInfo).catch((error) => {
              throw outcomeUnknown(error, txInfo.hash);
            })
          );
        }, gate)
      );

  const sent = (password ?? Promise.resolve())
    .catch((error) => {
      throw stillOpen(error);
    })
    .then(() =>
      // Asked for the latest block's height, the network says it answers.
      gate
        ? gate.untilHandedOver(attempt, (signal) =>
            networkStore.getCurrentBlockHeight(signal)
          )
        : attempt()
    )
    .catch((error) => {
      const hash = unconfirmedHash(error);

      if (hash) {
        followRemoval(/** @type {TransactionInfo} */ ({ hash }));
        record(/** @type {TransactionInfo} */ ({ hash }));
        lookFor(/** @type {TransactionInfo} */ ({ hash }));
      } else if (handedOver) {
        // Refused as it was handed over: it went nowhere.
        forget(/** @type {TransactionInfo} */ ({ hash: handedOver }));
      }

      throw error;
    })
    .then((txInfo) =>
      // It went out: what goes wrong from here doesn't say it didn't.
      Promise.resolve(txInfo)
        .then(passThruWithEffects(followRemoval))
        .then(passThruWithEffects(record))
        .then(passThruWithEffects(lookFor))
        .catch((error) => {
          throw outcomeUnknown(error, txInfo.hash);
        })
    );

  // Called off, it stops at once: what it waits on goes on, and stops at
  // the gate before the node is asked to broadcast it.
  return gate ? Promise.race([sent, gate.cancelled]) : sent;
};

/**
 * What else is read with the balances and the stake, to show with them, as
 * Sozu's position, which Home counts with them: each reads for the profile,
 * and gives what shows what it read, or null for nothing to read.
 *
 * @type {Set<(profile: Profile) => Promise<(() => void) | null>>}
 */
const readAlong = new Set();

/**
 * The reads of the balances, in the order they began, and the last of them
 * that showed: an older read that comes back last shows nothing, so the
 * balances and what's read along them always come from the same one.
 */
let balanceReadsBegun = 0;
let balanceReadShown = 0;

/**
 * Has `read` read with the balances and the stake each time they are, and
 * what it read shown with them.
 *
 * @type {WalletStoreServices["readWithBalances"]}
 */
function readWithBalances(read) {
  readAlong.add(read);

  return () => {
    readAlong.delete(read);
  };
}

/**
 * The current profile's balances and stake, read from the network together,
 * and shown together, with what's read along (`readWithBalances`): what a
 * transaction moved between them is never counted in both, or in neither.
 * What can't be read stays as it was; the balances read say so
 * (`balanceRead`). Each is kept in the cache, which is only a nice to have,
 * so a failure to keep it is ignored.
 *
 * @returns {Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]>}
 */
async function updateStaticInfo() {
  const session = walletSession;
  const profile = getCurrentProfile();

  if (!profile) {
    return [
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ];
  }

  const order = (balanceReadsBegun += 1);
  // Shown only where no read of them begun after it showed already: its
  // balances and what's read along them together, or neither.
  const isCurrent = () =>
    session === walletSession &&
    profile === getCurrentProfile() &&
    order > balanceReadShown;
  const [[balance, stake], along] = await Promise.all([
    Promise.allSettled([
      (async () => ({
        shielded: /** @type {AddressBalance} */ (
          await bookkeeper.balance(profile.address)
        ),
        unshielded: /** @type {AccountBalance} */ (
          await bookkeeper.balance(profile.account)
        ),
      }))(),
      /** @type {Promise<StakeInfo>} */ (bookkeeper.stakeInfo(profile.account)),
    ]),
    Promise.allSettled([...readAlong].map((read) => read(profile))),
  ]);

  if (!isCurrent()) {
    return [balance, stake];
  }

  await Promise.all([
    balance.status === "fulfilled" &&
      treasury.setCachedBalance(profile, balance.value).catch(() => {}),
    stake.status === "fulfilled" &&
      treasury.setCachedStakeInfo(profile, stake.value).catch(() => {}),
  ]);

  if (isCurrent()) {
    balanceReadShown = order;

    // In the same moment, what's read along first: no screen draws the
    // balances without it.
    for (const read of along) {
      if (read.status === "fulfilled") {
        read.value?.();
      }
    }

    update((currentStore) => ({
      ...currentStore,
      ...(balance.status === "fulfilled"
        ? { balance: balance.value, balanceRead: true }
        : {}),
      // What shows of balances that couldn't be read is what was read
      // before, as for the stake: also what the sync read before one that
      // failed, as the network couldn't be reached.
      balanceReadFailed:
        balance.status !== "fulfilled" ||
        currentStore.syncStatus.error !== null,
      ...(stake.status === "fulfilled" ? { stakeInfo: stake.value } : {}),
      // What shows of a stake that couldn't be read is what was read before.
      stakeReadFailed: stake.status !== "fulfilled",
    }));
  }

  return [balance, stake];
}

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
      network.execute(bookkeeper.as(profile).withdraw(amount).gas(gas)),
    { gas, staking: true }
  );
};

/** @type {WalletStoreServices["startHistory"]} */
const startHistory = () => historyOf(unsafeGetCurrentProfile());

/**
 * Opens the wallet's contacts with the key its seed makes, for the unlock
 * `session` is: they stay closed when there's none, or once that unlock
 * was cancelled.
 *
 * @param {ProfileGenerator} profileGenerator
 * @param {Profile} firstProfile
 * @param {number} session
 */
async function openContactsOf(profileGenerator, firstProfile, session) {
  try {
    const seed = await ProfileGenerator.seedFrom(profileGenerator);

    if (session !== walletSession) {
      return;
    }

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
    await openContactsOf(profileGeneratorInstance, profiles[0], session);
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
  // The next wallet's sends wait for none of this one's.
  sendsInTurn = Promise.resolve();
  cancelSendPassword(new WalletChangedError());
  cancelWaitingSends(new WalletChangedError());
  abortSync();
  stopActivity();
  forgetArrivals();
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

  // What shows is the other profile's until this one's are read: what was
  // read before, while the network doesn't answer.
  return store.profiles.includes(profile)
    ? Promise.resolve(
        set({
          ...store,
          balanceRead: false,
          balanceReadFailed: !isAnswering,
          currentProfile: profile,
          stakeReadFailed: !isAnswering,
        })
      ).then(async () => {
        await updateStaticInfo();
      })
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
    (network) =>
      network.execute(bookkeeper.as(profile).shield(amount).gas(gas)),
    { gas, moves: amount }
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
    (network) => network.execute(bookkeeper.as(profile).stake(amount).gas(gas)),
    { gas, moves: amount, staking: true }
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
    },
    {
      gas,
      moves: fnName === SOZU_FN.STAKE ? amount : 0n,
      staking: true,
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
    (network) => network.execute(bookkeeper.as(profile).topup(amount).gas(gas)),
    { gas, moves: amount, staking: true }
  );
};

/** @type {WalletStoreServices["sync"]} */
async function sync(fromBlock, { clear = false } = {}) {
  const session = walletSession;
  const store = get(walletStore);

  if (!store.initialized) {
    throw new Error(
      "The wallet store needs to be initialized with a profile generator"
    );
  }

  if (!syncPromise) {
    syncNumber++;
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
      if (from === 0n || clear) {
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
        // Stopped on purpose, it isn't tried again.
        const wasStopped = controller.signal.aborted;

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

          // It tries again by itself, as the network may be back by then.
          if (!wasStopped) {
            window.clearTimeout(autoSyncId);
            cancelSyncWhenShown();
            autoSyncId = window.setTimeout(autoSync, RETRY_AFTER_FAILURE);
          }
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

/**
 * The block a resync syncs the open wallet from, while it runs: null for
 * none.
 */
const resyncFrom = writable(/** @type {bigint | null} */ (null));

/**
 * Syncs the open wallet again from `fromBlock`, once what it synced is
 * cleared: its cache of notes, balances and where the sync got to, and its
 * public history, which the archive gives again. Its shielded history keeps
 * the heights it asks the archive among, and is worked out again from the
 * notes found. The contacts, settings, names, the vault and the other
 * wallets stay as they are. The sync under way, if any, stops for it, and
 * one resync runs at a time: another is refused meanwhile, and so is a
 * block below 0 or past the network's latest, before anything is cleared.
 * Once another wallet opened, or after a lock, it stops
 * (WalletChangedError).
 *
 * @type {WalletStoreServices["resync"]}
 */
async function resync(fromBlock) {
  const { initialized, profiles } = get(walletStore);

  if (!initialized) {
    throw new Error(
      "The wallet store needs to be initialized with a profile generator"
    );
  }

  if (typeof fromBlock !== "bigint" || fromBlock < 0n) {
    throw new RangeError("A block height is 0 or more.");
  }

  if (get(resyncFrom) !== null) {
    throw new Error("The wallet is syncing again already.");
  }

  const stillOpen = whileOpen();

  resyncFrom.set(fromBlock);

  try {
    // A block the network doesn't have yet clears nothing either.
    if (fromBlock > (await networkStore.getCurrentBlockHeight())) {
      throw new RangeError("The network has no block at that height yet.");
    }

    stillOpen();
    stopActivity();
    await forgetWalletActivity(
      {
        accounts: profiles.map((profile) => String(profile.account)),
        addresses: [],
      },
      ["entries", "meta"]
    );
    stillOpen();

    // This sync takes the place of the one under way at once, and clears
    // the cache before it finds any note.
    abortSync();
    await sync(fromBlock, { clear: true }).catch((error) => {
      throw stillOpen(error);
    });
    await updateStaticInfo();
  } finally {
    resyncFrom.set(null);
  }
}

/** @type {WalletStoreServices["transfer"]} */
const transfer = async (to, amount, memo, gas, { gate, toName } = {}) => {
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
    },
    { gas, gate, moves: amount }
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
    },
    { gas, moves: BigInt(amount) }
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
      network.execute(bookkeeper.as(profile).unshield(amount).gas(gas)),
    { gas, moves: amount }
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
      network.execute(bookkeeper.as(profile).unstake(amount).gas(gas)),
    { gas, staking: true }
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
    },
    { gas }
  );
};

/** Whether the network answered, as its pill last found it. */
let isAnswering = true;

// While the network doesn't answer, offline or silent, the balances and the
// stake that show are what was read before, and say so until a read gets
// through; once it answers again, they're read at once.
networkReach.subscribe((reach) => {
  const wasAnswering = isAnswering;

  isAnswering = reach === "answering";

  if (!get(walletStore).initialized) {
    return;
  }

  if (!isAnswering) {
    update((store) => ({
      ...store,
      balanceReadFailed: true,
      stakeReadFailed: true,
    }));
  } else if (!wasAnswering) {
    void refreshBalance();
  }
});

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
  readWithBalances,
  refreshBalance,
  releaseWallet,
  reset,
  resync,
  resyncing: { subscribe: resyncFrom.subscribe },
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
