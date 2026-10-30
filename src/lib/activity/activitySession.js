/**
 * One account's history while the wallet shows it: the kept history from
 * this browser, then sync runs with the archive by block height
 * (activityHistory.js), its counterparties' verified .dusk names, its
 * shielded history, and the wallet's own transactions, merged into rows
 * (`@dusk-network/app-core/activity`).
 *
 * The kept history paints at once. A run follows when the session starts,
 * and others after a transaction of this wallet goes through; nothing polls
 * otherwise. What a session keeps is tied to the store's epoch when it
 * started: after a wallet reset since, nothing more is kept. Stopping it,
 * for a lock or another profile, drops whatever its work brings back.
 */

import {
  PENDING_MS,
  activityRows,
  settleSends,
} from "@dusk-network/app-core/activity";
import { StaleHistoryError } from "@dusk-network/app-core/history";
import { ProfileGenerator } from "@dusk/w3sper";
import { get } from "svelte/store";

import { bridgeNetwork } from "$lib/bridge/bridgeCalls";
import { sozuPools } from "$lib/sozu/config";

import {
  activityNetworkKey,
  nameFacts,
  noteActivityUnavailable,
  publicHistory,
} from "./activityHistory";
import {
  StaleActivityError,
  activityOwnerKey,
  deleteLocalTransactions,
  getActivityEpoch,
  getCounterpartyNames,
  listLocalTransactions,
  putCounterpartyNames,
  putLocalTransaction,
} from "./activityStore";
import {
  NAME_CHECK_TTL_MS,
  lookupCounterpartyNames,
} from "./counterpartyNames";

/** Rows read at first, and how many more `showMore` adds. */
export const ACTIVITY_PAGE = 50;

/** The wait after a transaction went through before the archive is asked for it. */
export const AFTER_TX_MS = 20_000;

/** How long a session waits to ask again for a shielded history it couldn't have yet. */
export const SHIELDED_RETRY_MS = 60_000;

/**
 * @typedef {{
 *   account: string,
 *   namesNetwork: string,
 *   nodeUrl: string,
 *   profileIndex: number,
 *   shielded?: () => Promise<{ entries: import("@dusk-network/app-core/shielded").ShieldedEntry[], pending?: boolean }>,
 * }} ActivitySessionOptions
 *
 * @typedef {{
 *   complete: boolean,
 *   error: string | null,
 *   hasMore: boolean,
 *   loaded: boolean,
 *   rows: ActivityRow[],
 *   syncing: boolean,
 * }} ActivityState
 */

/** One account's history on one node, while it is shown. */
export class ActivitySession {
  /** @type {Set<string>} */
  #checked = new Set();

  complete = false;

  /** @type {ActivityEntry[]} */
  #entries = [];

  /** @type {Promise<number | undefined>} */
  #epoch;

  error = /** @type {string | null} */ (null);

  /** @type {import("@dusk-network/app-core/history").History | null} */
  #history = null;

  key;

  #limit = ACTIVITY_PAGE;

  /** @type {Set<(state: ActivityState) => void>} */
  #listeners = new Set();

  loaded = false;

  /** @type {ActivityLocalRecord[]} */
  #local = [];

  /** @type {import("@dusk-network/app-core/history").HistoryState | null} */
  #meta = null;

  /** @type {Map<string, string | null>} */
  #names = new Map();

  options;

  ownerKey;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #refreshTimer;

  #runAgain = false;

  /** @type {import("@dusk-network/app-core/shielded").ShieldedEntry[]} */
  #shielded = [];

  #shieldedAsked = false;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #shieldedTimer;

  #stale = false;

  /** @type {Promise<void> | null} */
  #started = null;

  #stopped = false;

  syncing = false;

  /** @param {ActivitySessionOptions} options */
  constructor(options) {
    this.options = options;
    this.key = `${options.nodeUrl}\n${options.account}`;
    this.ownerKey = activityOwnerKey(
      activityNetworkKey(options.nodeUrl),
      options.account
    );

    // The store's epoch now; undefined when it can't be read.
    this.#epoch = getActivityEpoch().catch(() => undefined);
  }

  /** The counterparties of the shown entries that can have a name. */
  #counterparties() {
    return [
      ...new Set(
        this.#entries
          .map((e) => e.counterparty)
          .filter(
            (c) =>
              typeof c === "string" &&
              c !== this.options.account &&
              ProfileGenerator.typeOf(c) === "account"
          )
      ),
    ].map(String);
  }

  /** Names kept from a check in the last ten minutes. */
  async #keptNames() {
    const accounts = this.#counterparties();

    if (!accounts.length) {
      return;
    }

    const now = Date.now();
    const kept = await getCounterpartyNames(
      this.options.namesNetwork,
      accounts
    );

    for (const [account, { at, name }] of kept) {
      if (now - at >= 0 && now - at < NAME_CHECK_TTL_MS) {
        this.#names.set(account, name);
      }
    }
  }

  /** The shown counterparties' names, checked again: one Multicall query for up to 32. */
  async #checkNames() {
    const due = this.#counterparties().filter((c) => !this.#checked.has(c));

    if (!due.length) {
      return;
    }

    for (const c of due) {
      this.#checked.add(c);
    }

    const { namesNetwork, nodeUrl } = this.options;
    const names = await lookupCounterpartyNames(due, {
      network: namesNetwork,
      nodeUrl,
    });

    // A lookup that failed leaves the name kept, and is made again by the
    // next run.
    for (const c of due) {
      if (names.has(c)) {
        this.#names.set(c, /** @type {string | null} */ (names.get(c)));
      } else {
        this.#checked.delete(c);
      }
    }

    const epoch = await this.#epoch;

    if (epoch !== undefined) {
      await putCounterpartyNames(namesNetwork, names, { epoch }).catch(
        () => {}
      );
    }

    this.#emit();
  }

  #emit() {
    if (this.#stopped) {
      return;
    }

    const state = this.state;

    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  /**
   * The profile's shielded history, once the public one is shown. One the
   * wallet couldn't give yet, as while its notes sync, is asked for again
   * once they are synced, or a minute later.
   */
  async #loadShielded() {
    if (this.#shieldedAsked || !this.options.shielded || this.#stopped) {
      return;
    }

    this.#shieldedAsked = true;
    clearTimeout(this.#shieldedTimer);

    try {
      const result = await this.options.shielded();

      this.#shielded = result.entries;

      if (result.pending) {
        this.#askShieldedAgain();
      }

      await this.#settleLocal();
      this.#emit();
    } catch {
      this.#askShieldedAgain();
    }
  }

  #askShieldedAgain() {
    this.#shieldedAsked = false;
    clearTimeout(this.#shieldedTimer);
    this.#shieldedTimer = setTimeout(() => {
      void this.#loadShielded();
    }, SHIELDED_RETRY_MS);
  }

  /** The account's public history, made once the store's epoch is known. */
  async #publicHistory() {
    const { account, nodeUrl } = this.options;
    const epoch = await this.#epoch;

    this.#history ??= publicHistory({ account, epoch, nodeUrl });

    return this.#history;
  }

  async #reload() {
    const [read, local] = await Promise.all([
      this.#publicHistory().then((h) => h.read({ limit: this.#limit })),
      listLocalTransactions(this.ownerKey),
    ]);

    this.#entries = read.entries;
    this.#meta = read.state;
    this.complete = read.complete;
    this.#local = local;
    this.loaded = true;
  }

  /**
   * Settles the wallet's own records the chain has an outcome for, in the
   * archive or in the shielded history (`settleSends`): a record with what
   * the chain's row lacks, as the name typed for the recipient or what a
   * failed send tried to move, stays with it; the others go.
   */
  async #settleLocal() {
    const { drop, keep } = settleSends({
      pending: this.#local,
      public: this.#entries,
      shielded: this.#shielded,
    });
    const settled = /** @type {ActivityLocalRecord[]} */ (keep);

    if (!drop.length && !settled.length) {
      return;
    }

    const epoch = await this.#epoch;

    await deleteLocalTransactions(this.ownerKey, drop).catch(() => {});

    for (const record of settled) {
      await putLocalTransaction(this.ownerKey, record, epoch).catch(() => {});
    }

    const kept = new Map(settled.map((record) => [record.hash, record]));

    this.#local = this.#local.flatMap((r) =>
      drop.includes(r.hash) ? [] : [kept.get(r.hash) ?? r]
    );
  }

  /** Whether one of the wallet's own sends still waits for the archive. */
  #waitsForArchive() {
    const now = Date.now();

    return this.#local.some(
      (r) =>
        r.status === "submitted" &&
        !r.settled &&
        now - r.submittedAt < PENDING_MS
    );
  }

  async #sync() {
    const epoch = await this.#epoch;

    if (epoch === undefined) {
      throw new Error("The activity store is out of reach");
    }

    const history = await this.#publicHistory();

    await history.sync({
      onStep: () => {
        this.#reload()
          .then(() => this.#emit())
          .catch(() => {});
      },
    });
  }

  /**
   * A sync run, its error kept for the state. One another run overtook says
   * nothing: the history is that run's.
   */
  async #syncAndNote() {
    try {
      await this.#sync();
      this.error = null;
    } catch (error) {
      if (error instanceof StaleActivityError) {
        this.#stale = true;
      } else if (!(error instanceof StaleHistoryError)) {
        this.error = /** @type {any} */ (error)?.message ?? String(error);
        noteActivityUnavailable(error);
      }
    }
  }

  async #run() {
    // The wallet was reset since this session started.
    if (this.#stale || this.#stopped) {
      return;
    }

    if (this.syncing) {
      this.#runAgain = true;

      return;
    }

    this.syncing = true;
    this.#emit();
    await this.#syncAndNote();
    this.syncing = false;
    await this.#afterRun();
  }

  async #afterRun() {
    // Another profile's now, or reset: nothing more for this one.
    if (this.#stopped || this.#stale) {
      return;
    }

    await this.#reload().catch(() => {});
    await this.#settleLocal();
    this.#emit();
    await this.#checkNames().catch(() => {});
    void this.#loadShielded();

    if (this.#runAgain) {
      this.#runAgain = false;
      await this.#run();
    } else if (this.#waitsForArchive()) {
      this.refreshSoon();
    }
  }

  /**
   * The rows, newest first: the bridge's calls read on the bridge the
   * wallet sends them to, and Sozu's calls on the pools its hub named too.
   *
   * @returns {ActivityRow[]}
   */
  get rows() {
    const { account, profileIndex } = this.options;

    return activityRows({
      account,
      nameCall: nameFacts,
      names: this.#names,
      network: bridgeNetwork(),
      pending: this.#local,
      pools: get(sozuPools),
      profileIndex,
      public: this.#entries,
      shielded: this.#shielded,
      state: this.#meta,
    });
  }

  /** @returns {ActivityState} */
  get state() {
    return {
      complete: this.complete,
      error: this.error,
      hasMore:
        this.loaded && (!this.complete || this.#entries.length >= this.#limit),
      loaded: this.loaded,
      rows: this.rows,
      syncing: this.syncing,
    };
  }

  /**
   * The time, outcome and fee of one synced entry, for its details, when no
   * sync looked them up yet: one request.
   *
   * @param {string} hash
   */
  async loadDetail(hash) {
    const entry = this.#entries.find((e) => e.hash === hash);
    const epoch = await this.#epoch;
    const history = await this.#publicHistory();

    if (!entry || !history.needsDetails(entry) || epoch === undefined) {
      return;
    }

    await history.fillDetails([entry]);
    await this.#reload();
    this.#emit();
  }

  /**
   * Keep one of the wallet's own transactions, shown until the archive has
   * it, and look for it once it went through.
   *
   * @param {Omit<ActivityLocalRecord, "id" | "ownerKey" | "status" | "submittedAt">} record
   */
  async recordSent(record) {
    const epoch = await this.#epoch;

    await putLocalTransaction(
      this.ownerKey,
      { ...record, status: "submitted", submittedAt: Date.now() },
      epoch
    );
    await this.#reload();
    this.#emit();
    this.refreshSoon();
  }

  /**
   * A sync run now, for what is new on chain.
   *
   * @returns {Promise<void>}
   */
  refresh() {
    clearTimeout(this.#refreshTimer);

    return this.#run();
  }

  /**
   * One more sync run, after a transaction of this wallet went through: the
   * archive has it once its block is final.
   *
   * @param {number} [delayMs]
   */
  refreshSoon(delayMs = AFTER_TX_MS) {
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      void this.refresh();
    }, delayMs);
  }

  /**
   * The wallet's notes are synced, and can be new, as after a send: the
   * shielded history is asked for again, kept unless they changed. A run
   * under way asks for it anyway.
   */
  notesSynced() {
    this.#shieldedAsked = false;

    if (this.loaded && !this.syncing) {
      void this.#loadShielded();
    }
  }

  /** The next page of kept history, and a sync run for older history when the kept history runs out. */
  async showMore() {
    // From the rows shown: a read gives a block the page cuts through whole.
    this.#limit = Math.max(this.#limit, this.#entries.length) + ACTIVITY_PAGE;
    await this.#reload().catch(() => {});
    this.#emit();

    const history = await this.#publicHistory();
    const missing = this.#entries.filter(history.needsDetails);
    const epoch = await this.#epoch;

    if (missing.length && epoch !== undefined) {
      await history.fillDetails(missing).catch(() => {});
      await this.#reload().catch(() => {});
      this.#emit();
    }

    await this.#checkNames().catch(() => {});

    if (!this.complete && this.#entries.length < this.#limit) {
      await this.#run();
    }
  }

  async #start() {
    try {
      await this.#reload();
      await this.#keptNames();
    } catch {
      // No store here: the archive's answer comes after the sync.
    }

    this.#emit();
    await this.#run();
  }

  /**
   * Paints the kept history, then makes a sync run, once. Resolves after it.
   *
   * @returns {Promise<void>}
   */
  start() {
    this.#started ??= this.#start();

    return this.#started;
  }

  /** Drops the session: whatever its work brings back is ignored. */
  stop() {
    this.#stopped = true;
    clearTimeout(this.#refreshTimer);
    clearTimeout(this.#shieldedTimer);
    this.#listeners.clear();
  }

  /**
   * @param {(state: ActivityState) => void} listener
   * @returns {() => void} Unsubscribes
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.state);

    return () => this.#listeners.delete(listener);
  }
}
