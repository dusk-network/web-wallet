import notesArrayToMap from "$lib/wallet/notesArrayToMap";
import { currentWalletCache } from "$lib/wallet-cache";
import networkStore from "$lib/stores/networkStore";

/** The most nullifiers one request asks about: each fits in a contract call. */
const NULLIFIERS_PER_REQUEST = 1_000;

class WalletTreasury {
  /** @type {AccountBalance[]} */
  #accountBalances = [];

  #generation = 0;

  #profiles;

  /** @type {StakeInfo[]} */
  #accountStakeInfo = [];

  /**
   * @param {bigint} lastBlockHeight
   * @param {ReturnType<typeof currentWalletCache>} walletCache
   * @returns {Promise<WalletCacheSyncInfo>}
   */
  async #getEnrichedSyncInfo(lastBlockHeight, walletCache) {
    const [currentSyncInfo, lastBlockHash, lastFinalizedBlockHeight] =
      await Promise.all([
        walletCache.getSyncInfo(),
        networkStore.getBlockHashByHeight(lastBlockHeight).catch(() => ""),
        networkStore.getLastFinalizedBlockHeight().catch(() => 0n),
      ]);

    return {
      block: {
        hash: lastBlockHash,
        height: lastBlockHeight,
      },
      bookmark: currentSyncInfo.bookmark,
      lastFinalizedBlockHeight,
    };
  }

  /** @param {Profile[]} profiles */
  constructor(profiles = []) {
    this.#profiles = profiles;
  }

  /**
   * @param {Profile["account"]} identifier
   * @returns {Promise<AccountBalance>}
   */
  async account(identifier) {
    const balance = this.#accountBalances.at(+identifier);

    return (
      balance ??
      Promise.reject(
        new Error("No balance found for the account with the given identifier")
      )
    );
  }

  /**
   * @param {Profile["address"]} identifier
   * @returns {Promise<Map<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>>}
   */
  async address(identifier) {
    const address = identifier.toString();
    const result = [];
    const walletCache = currentWalletCache();
    const notes = await walletCache.getUnspentNotes([address]);

    for (const note of notes) {
      if (
        (await walletCache.getPendingNotesInfo([note.nullifier])).length === 0
      ) {
        result.push(note);
      }
    }

    return result.length
      ? /** @type {Map<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>} */ (
          notesArrayToMap(result).get(address)
        )
      : new Map();
  }

  /** @returns {Promise<void>} */
  async clearCache() {
    await currentWalletCache().clear();
  }

  /**
   * @param {Profile} profile
   * @returns {Promise<WalletCacheBalanceInfo["balance"]>}
   */
  async getCachedBalance(profile) {
    return await currentWalletCache().getBalanceInfo(
      profile.address.toString()
    );
  }

  /**
   * @param {Profile} profile
   * @returns {Promise<StakeInfo>}
   */
  async getCachedStakeInfo(profile) {
    return await currentWalletCache().getStakeInfo(profile.account.toString());
  }

  /**
   * @returns {Promise<WalletCacheSyncInfo>}
   */
  async getCachedSyncInfo() {
    return await currentWalletCache().getSyncInfo();
  }

  reset() {
    this.#accountBalances = [];
    this.#accountStakeInfo = [];
    this.#profiles = [];
    this.#generation++;
  }

  /**
   * @param {Profile} profile
   * @param {WalletCacheBalanceInfo["balance"]} balance
   * @returns {Promise<void>}
   */
  async setCachedBalance(profile, balance) {
    await currentWalletCache().setBalanceInfo(
      profile.address.toString(),
      balance
    );
  }

  /**
   * @param {Profile} profile
   * @param {StakeInfo} stakeInfo
   * @returns {Promise<void>}
   */
  async setCachedStakeInfo(profile, stakeInfo) {
    await currentWalletCache().setStakeInfo(
      profile.account.toString(),
      stakeInfo
    );
  }

  /** @param {Profile[]} profiles */
  setProfiles(profiles) {
    this.#accountBalances = [];
    this.#accountStakeInfo = [];
    this.#profiles = profiles;
    this.#generation++;
  }

  /**
   * @param {Profile["account"]} identifier
   * @returns {Promise<StakeInfo>}
   */
  async stakeInfo(identifier) {
    const stakeInfo = this.#accountStakeInfo.at(+identifier);

    return (
      stakeInfo ??
      Promise.reject(
        new Error(
          "No stake info found for the account with the given identifier"
        )
      )
    );
  }

  /**
   * @param {bigint | Bookmark} from
   * @param {(evt: CustomEvent) => void} syncIterationListener
   * @param {AbortSignal} signal
   */
  // eslint-disable-next-line max-statements
  async update(from, syncIterationListener, signal) {
    const generation = this.#generation;

    // The open wallet's cache, throughout: the next wallet's isn't touched.
    const walletCache = currentWalletCache();
    const ensureCurrent = () => {
      if (generation !== this.#generation || signal.aborted) {
        throw new Error("Synchronization aborted");
      }
    };
    let lastBlockHeight = 0n;

    /** @type {(evt: CustomEvent) => void} */
    const lastBlockHeightListener = ({ detail }) => {
      lastBlockHeight = detail.blocks.last;
    };
    const accountSyncer = await networkStore.getAccountSyncer();
    const addressSyncer = await networkStore.getAddressSyncer();
    const eventName = "synciteration";
    const cleanup = () => {
      // @ts-ignore
      addressSyncer.removeEventListener(eventName, lastBlockHeightListener);

      // @ts-ignore
      addressSyncer.removeEventListener(eventName, syncIterationListener);
    };
    let profiles = this.#profiles;

    try {
      ensureCurrent();

      // @ts-ignore
      addressSyncer.addEventListener(eventName, lastBlockHeightListener);

      // @ts-ignore
      addressSyncer.addEventListener(eventName, syncIterationListener);

      const [accountBalances, accountStakeInfo] = await Promise.all([
        accountSyncer.balances(profiles),
        accountSyncer.stakes(profiles),
      ]);

      ensureCurrent();
      this.#accountBalances = accountBalances;
      this.#accountStakeInfo = accountStakeInfo;

      const notesStream = await addressSyncer.notes(profiles, {
        from,
        signal,
      });

      ensureCurrent();

      /**
       * For each chunk of data in the stream we enrich the sync
       * info with the block hash, that will be used to check that
       * our local state is consistent with the remote one.
       * This way we can ensure that if a user interrupts the sync
       * while it's still in progress we can safely resume it from
       * the stored bookmark if no block has been rejected in the
       * meantime.
       */
      for await (const [notesInfo, streamSyncInfo] of notesStream) {
        const notesSyncInfo = {
          block: {
            hash: await networkStore
              .getBlockHashByHeight(streamSyncInfo.blockHeight)
              .catch(() => ""),
            height: streamSyncInfo.blockHeight,
          },
          bookmark: streamSyncInfo.bookmark,
        };

        ensureCurrent();
        await walletCache.addUnspentNotes(
          walletCache.toCacheNotes(notesInfo, profiles),
          notesSyncInfo
        );
      }

      profiles = [];
      ensureCurrent();

      // gather all unspent and spent nullifiers in the cache
      const currentUnspentNullifiers =
        await walletCache.getUnspentNotesNullifiers();
      ensureCurrent();
      const currentSpentNullifiers =
        await walletCache.getSpentNotesNullifiers();
      ensureCurrent();

      /**
       * One request says which of them the network has spent, one for
       * each 1,000 of them: the unspent ones it has are spent now, and
       * the spent ones it hasn't are unspent again, as when a block was
       * rejected. With no notes, nothing is asked.
       *
       * Currently `w3sper.js` returns an array of `ArrayBuffer`s
       * instead of one of `Uint8Array<ArrayBuffer>`s.
       */
      const nullifiers = [
        ...currentUnspentNullifiers,
        ...currentSpentNullifiers,
      ];
      const spentNullifiers = new Set();

      for (let i = 0; i < nullifiers.length; i += NULLIFIERS_PER_REQUEST) {
        const found = await addressSyncer.spent(
          nullifiers.slice(i, i + NULLIFIERS_PER_REQUEST)
        );

        ensureCurrent();
        found.forEach((buffer) =>
          spentNullifiers.add(String(new Uint8Array(buffer)))
        );
      }

      /** @param {Uint8Array<ArrayBuffer>} nullifier */
      const isSpent = (nullifier) => spentNullifiers.has(String(nullifier));
      const nullifiersSpent = currentUnspentNullifiers.filter(isSpent);
      const nullifiersToUnspend = currentSpentNullifiers.filter(
        (nullifier) => !isSpent(nullifier)
      );

      // update the cache with the spent nullifiers info
      ensureCurrent();
      if (nullifiersSpent.length) {
        await walletCache.spendNotes(nullifiersSpent);
      }

      ensureCurrent();
      if (nullifiersToUnspend.length) {
        await walletCache.unspendNotes(nullifiersToUnspend);
      }

      /**
       * We enrich the sync info by retrieving the hash of the last
       * processed block and the height of the last finalized block.
       * We'll use this information at the start of the sync
       * to determine if a block has been rejected, so that we can
       * fix our local cache state by syncing from the last finalized
       * block height.
       */
      const syncInfo = await this.#getEnrichedSyncInfo(
        lastBlockHeight,
        walletCache
      );
      ensureCurrent();
      await walletCache.setSyncInfo(syncInfo);
    } finally {
      profiles = [];
      cleanup();
    }
  }

  /**
   * @param {Profile} profile
   * @param {bigint} nonce
   * @returns {Promise<void>}
   */
  async updateCachedNonce(profile, nonce) {
    const address = profile.address.toString();
    const walletCache = currentWalletCache();
    const currentBalance = await walletCache.getBalanceInfo(address);

    await walletCache.setBalanceInfo(address, {
      ...currentBalance,
      unshielded: { ...currentBalance.unshielded, nonce },
    });
  }

  /**
   * @param {Uint8Array<ArrayBuffer>[]} nullifiers
   * @param {string} hash
   * @returns {Promise<void>}
   */
  async updateCachedPendingNotes(nullifiers, hash) {
    await currentWalletCache().setPendingNotesInfo(nullifiers, hash);
  }
}

export default WalletTreasury;
