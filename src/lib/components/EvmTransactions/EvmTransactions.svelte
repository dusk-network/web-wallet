<svelte:options immutable={true} />

<script>
  /**
   * Bridge › Activity: the deposits and withdrawals between Dusk and
   * DuskEVM, as the Dusk Bridge lists its transfers, each with its route,
   * amount, date or claim date, state, and what needs doing. A row opens to
   * its steps, where a withdrawal is proved or claimed.
   */
  import { page } from "$app/stores";
  import { onMount, tick } from "svelte";
  import { mdiArrowRight, mdiWalletOutline } from "@mdi/js";
  import { fade } from "svelte/transition";

  import { activityState } from "$lib/activity";
  import bridgeTimes from "$lib/bridge/bridgeTimes";
  import {
    depositActivityStore,
    hydrateDepositActivity,
    resumeDepositTracking,
  } from "$lib/bridge/depositActivity";
  import { DEPOSIT, WITHDRAWAL, routeTime } from "$lib/bridge/routeTimes";
  import { Button, Icon, Textbox } from "$lib/dusk/components";
  import { errorMessage } from "$lib/dusk/error";
  import { addBasePath } from "$lib/navigation";
  import { settingsStore } from "$lib/stores";
  import {
    finalizeWithdrawal,
    getWithdrawalFinalizationConfig,
    isWithdrawalTxHash,
    proveWithdrawal,
  } from "$lib/bridge/withdrawals";
  import {
    historyWithdrawals,
    hydrateWithdrawalActivity,
    loadWithdrawalActivity,
    mergeWithdrawalActivity,
    recordWithdrawalSubmission,
    refreshWithdrawalTransaction,
    rememberHistoryWithdrawals,
    rememberWithdrawalTransaction,
    resumeWithdrawalTracking,
    trackWithdrawalTransaction,
    withdrawalActivityStore,
  } from "$lib/bridge/withdrawalActivity";
  import { account, modal } from "$lib/web3/walletConnection";

  import nodeNetwork from "$lib/stores/nodeNetwork";
  import { cardRoutes } from "$lib/bridge/cardRoutes";
  import {
    hydrateMigrations,
    keptMigrations,
    migrationTransfers,
    serviceTransfers,
    transferArrivals,
  } from "$lib/bridge/migrationActivity";
  import { followTransfers, toFollow } from "$lib/bridge/routeTracking";

  import Banner from "../Banner/Banner.svelte";
  import NetworkMark from "../NetworkPicker/NetworkMark.svelte";
  import SwapCard from "../SwapCard/SwapCard.svelte";
  import DepositLifecycle from "./DepositLifecycle.svelte";
  import RouteTransferDetails from "./RouteTransferDetails.svelte";
  import WithdrawalLifecycle from "./WithdrawalLifecycle.svelte";
  import {
    depositRow,
    groupBridgeActivity,
    routeTransferRow,
    withdrawalRow,
  } from "./bridgeActivity";
  import { formatTimestamp, shortened } from "./withdrawalPresentation";

  const finalizationConfig = getWithdrawalFinalizationConfig();
  const POLL_INTERVAL_MS = 30_000;

  /** @type {string} */
  let txHash = "";

  /** @type {any[]} */
  let activity = [];

  /** @type {any[]} */
  let indexedActivity = [];

  /** @type {any[]} */
  let rememberedActivity = [];

  /** @type {string} */
  let statusError = "";

  /** @type {string} */
  let activityError = "";

  /** Why the history's withdrawals couldn't be found on DuskEVM's explorer. */
  let historyError = "";

  /**
   * The withdrawals the history knows, by their hashes: listed with or
   * without an EVM wallet connected.
   *
   * @type {Set<string>}
   */
  let historyHashes = new Set();

  /** @type {string} */
  let hashError = "";

  /** @type {Date | null} */
  let lastCheckedAt = null;

  /** @type {number} */
  let activityLoadedAt = 0;

  /** @type {boolean} */
  let isChecking = false;

  /** @type {boolean} */
  let isActivityLoading = false;

  /** @type {boolean} */
  let isSubmitting = false;

  /** @type {string | null | undefined} */
  let observedAccount;

  /** @type {string | null} */
  let currentAccount = null;

  /** @type {string | null} */
  let selectedTransactionHash = null;

  /** @type {any} */
  let selectedActivity = null;

  /** @type {any} */
  let selectedWithdrawal = null;

  /** @type {boolean} */
  let canCheck = false;

  /** @type {number} */
  let activityRequest = 0;

  /** @type {number} */
  let statusRequest = 0;

  /** The deposits this browser keeps, of any account. */
  /** @type {any[]} */
  let keptDeposits = [];

  /** The connected DuskEVM account's deposits, and those of none. */
  /** @type {any[]} */
  let deposits = [];

  /** The deposit shown open, by its transaction. */
  /** @type {string | null} */
  let openDeposit = null;

  /**
   * The migration or transfer out shown open, as its row's ID; or one a
   * link names, to open once the history has it.
   *
   * @type {string | null}
   */
  let openTransfer = null;

  /** @type {string | null} */
  let linkedTransfer = null;

  /**
   * The transfer a link names (`?tx=`) while no deposit listed is it: a
   * deposit of an account that isn't connected yet opens once it is,
   * unless a row was opened or a hash checked since.
   *
   * @type {string | null}
   */
  let linkedDeposit = null;

  function filterDeposits() {
    deposits = keptDeposits.filter(
      (item) =>
        item.account === null ||
        (currentAccount !== null && item.account === currentAccount)
    );
    openLinkedDeposit();
  }

  /**
   * Opens the deposit the link names once it's listed, and drops what
   * checking the link as a withdrawal's hash said.
   */
  function openLinkedDeposit() {
    const found = linkedDeposit
      ? deposits.find((item) => item.transactionHash === linkedDeposit)
      : null;

    if (!found) {
      return;
    }

    linkedDeposit = null;
    linkedTransfer = null;
    statusRequest += 1;
    isChecking = false;
    selectedTransactionHash = null;
    txHash = "";
    hashError = "";
    statusError = "";
    openTransfer = null;
    openDeposit = found.transactionHash;
  }

  /** @param {import("./bridgeActivity").BridgeActivityRow} row */
  const isOpen = (row) =>
    row.kind === "withdrawal"
      ? selectedTransactionHash === row.hash
      : row.kind === "deposit"
        ? openDeposit === row.hash
        : openTransfer === row.id;

  // A withdrawal opened from its row, its hash or a link closes the others.
  $: if (selectedTransactionHash) {
    openDeposit = null;
    openTransfer = null;
  }

  // The row shown open, for the list to follow.
  $: openId = selectedTransactionHash
    ? `withdrawal:${selectedTransactionHash}`
    : openDeposit
      ? `deposit:${openDeposit}`
      : openTransfer;

  /**
   * Opens a row to its steps, or closes it: one row is open at a time.
   *
   * @param {import("./bridgeActivity").BridgeActivityRow} row
   */
  function toggleRow(row) {
    linkedDeposit = null;
    linkedTransfer = null;

    if (row.kind === "withdrawal") {
      openDeposit = null;
      openTransfer = null;
      void selectActivity(row.item);

      return;
    }

    if (selectedTransactionHash) {
      void selectActivity({ transactionHash: selectedTransactionHash });
    }

    if (row.kind === "deposit") {
      openTransfer = null;
      openDeposit = openDeposit === row.hash ? null : row.hash;
    } else {
      openDeposit = null;
      openTransfer = openTransfer === row.id ? null : row.id;
    }
  }

  /**
   * A withdrawal's Prove or Claim: its steps open, with the date its proof
   * gives where it's proved now, and the button that sends it.
   *
   * @param {import("./bridgeActivity").BridgeActivityRow} row
   */
  async function startAction(row) {
    if (!isOpen(row)) {
      toggleRow(row);
    }

    await tick();

    /** @type {HTMLButtonElement | null} */
    const send = document.querySelector(
      `[id="bridge-details-${row.hash}"] .status-actions button`
    );

    send?.focus();
  }

  /**
   * @returns {`0x${string}`}
   */
  function checkedStatusTxHash() {
    if (!isWithdrawalTxHash(selectedWithdrawal?.transactionHash)) {
      throw new Error("Check the withdrawal status before continuing.");
    }

    return selectedWithdrawal.transactionHash;
  }

  function rebuildActivity() {
    const remembered = rememberedActivity.filter(
      (item) =>
        item.account === null ||
        (currentAccount !== null && item.account === currentAccount) ||
        (item.withdrawalHash !== null && historyHashes.has(item.withdrawalHash))
    );
    activity = mergeWithdrawalActivity(remembered, indexedActivity);
  }

  /**
   * Lists the withdrawals the history knows, proved or claimed by this
   * account on Dusk, and follows them: those not remembered here yet are
   * found on DuskEVM's explorer by their nonces.
   *
   * @param {ActivityRow[]} rows
   */
  async function showHistoryWithdrawals(rows) {
    const known = historyWithdrawals(rows);

    historyHashes = new Set(known.map(({ hash }) => hash));
    rebuildActivity();

    for (const item of rememberedActivity) {
      if (item.withdrawalHash && historyHashes.has(item.withdrawalHash)) {
        void trackWithdrawalTransaction(item.transactionHash);
      }
    }

    try {
      for (const item of await rememberHistoryWithdrawals(known)) {
        void trackWithdrawalTransaction(item.transactionHash);
      }

      historyError = "";
    } catch (error) {
      historyError = errorMessage(error);
    }
  }

  /**
   * @param {{ error: string | null, items: any[] }} result
   */
  function applyActivityResult(result) {
    indexedActivity = result.items;
    activityError = result.error ?? "";
    activityLoadedAt = Date.now();
    rebuildActivity();

    for (const item of result.items) {
      const remembered = rememberWithdrawalTransaction(item.transactionHash, {
        account: item.account,
        amountWei: item.amountWei,
        createdAt: item.createdAt,
      });

      if (remembered && item.stage !== "finalized") {
        void trackWithdrawalTransaction(remembered.transactionHash);
      }
    }
  }

  /** Whether a DuskEVM withdrawal or deposit listed is under way. */
  const isDuskEvmUnderWay = () =>
    activity.some(({ stage }) => stage !== "finalized" && stage !== "failed") ||
    deposits.some(({ stage }) => stage !== "completed" && stage !== "failed");

  /** Whether the transfers to and from other chains are being followed. */
  let following = false;

  async function follow() {
    if (following) {
      return;
    }

    following = true;

    try {
      await followTransfers(transfers, $transferArrivals);
    } finally {
      following = false;
    }
  }

  async function refreshActivity() {
    const request = ++activityRequest;
    const requestedAccount = currentAccount;
    isActivityLoading = true;

    try {
      const result = await loadWithdrawalActivity(requestedAccount);

      if (request !== activityRequest || requestedAccount !== currentAccount) {
        return;
      }

      applyActivityResult(result);
    } finally {
      if (request === activityRequest) {
        isActivityLoading = false;
      }
    }
  }

  /**
   * @param {string} value
   * @param {boolean} reportValidation
   * @returns {`0x${string}` | null}
   */
  function validatedStatusHash(value, reportValidation) {
    const normalized = value.trim();

    if (!isWithdrawalTxHash(normalized)) {
      if (reportValidation) {
        hashError = "Enter a 0x-prefixed 32-byte transaction hash.";
        statusError = "";
      }

      return null;
    }

    if (reportValidation) {
      txHash = normalized;
      hashError = "";
    }

    statusError = "";

    return /** @type {`0x${string}`} */ (normalized);
  }

  /**
   * @param {`0x${string}`} hash
   */
  function rememberCheckedTransaction(hash) {
    const remembered = rememberWithdrawalTransaction(hash, {
      account: currentAccount,
    });

    if (remembered) {
      selectedTransactionHash = remembered.transactionHash;
    }

    return remembered;
  }

  function finalizationIsConfigured() {
    if (!finalizationConfig.configured) {
      statusError = "Withdrawal finalization is not configured.";
      return false;
    }

    return true;
  }

  /**
   * @param {string} [hash]
   * @param {boolean} [reportValidation]
   */
  async function checkStatus(hash = txHash, reportValidation = true) {
    const checkedHash = validatedStatusHash(hash, reportValidation);

    if (!checkedHash) return;

    const remembered = rememberCheckedTransaction(checkedHash);

    if (!remembered || !finalizationIsConfigured()) return;

    const request = ++statusRequest;
    isChecking = true;

    try {
      const updated = await refreshWithdrawalTransaction(checkedHash);
      void trackWithdrawalTransaction(checkedHash);

      if (
        request === statusRequest &&
        selectedTransactionHash === checkedHash
      ) {
        statusError = updated?.actionError ?? "";
      }
    } catch (error) {
      if (request === statusRequest) {
        statusError = errorMessage(error);
      }
    } finally {
      if (request === statusRequest) {
        isChecking = false;
      }
    }
  }

  /**
   * @param {any} item
   */
  async function selectActivity(item) {
    if (selectedTransactionHash === item.transactionHash) {
      statusRequest += 1;
      selectedTransactionHash = null;
      statusError = "";
      isChecking = false;
      return;
    }

    selectedTransactionHash = item.transactionHash;
    txHash = item.transactionHash;
    hashError = "";
    statusError = "";

    await checkStatus(item.transactionHash, false);
  }

  /**
   * @param {(hash: `0x${string}`) => Promise<string>} action
   * @param {"finalize" | "prove"} actionName
   */
  async function submitWithdrawalAction(action, actionName) {
    isSubmitting = true;
    statusError = "";

    try {
      const checkedHash = checkedStatusTxHash();
      const submittedHash = await action(checkedHash);
      recordWithdrawalSubmission(checkedHash, {
        action: actionName,
        hash: submittedHash,
      });
    } catch (error) {
      // The card shows a short line; the raw error stays in the console.
      // eslint-disable-next-line no-console
      console.error(`Withdrawal ${actionName} failed`, error);
      statusError = errorMessage(error);
    } finally {
      isSubmitting = false;
    }
  }

  function submitProof() {
    return submitWithdrawalAction(proveWithdrawal, "prove");
  }

  function submitFinalization() {
    return submitWithdrawalAction(finalizeWithdrawal, "finalize");
  }

  /**
   * Checks a link that names no deposit or transfer here as a withdrawal's
   * hash.
   *
   * @param {string} linked
   */
  function checkLinkedWithdrawal(linked) {
    // A withdrawal's hash names no deposit: none is waited for.
    if (isWithdrawalTxHash(linked)) {
      linkedDeposit = null;
    }

    txHash = linked;

    const remembered = isWithdrawalTxHash(linked)
      ? rememberWithdrawalTransaction(linked, { account: currentAccount })
      : null;

    if (remembered) {
      selectedTransactionHash = remembered.transactionHash;
    }

    void checkStatus();
  }

  /**
   * Opens the transfer the page's link names (`?tx=`): a deposit, a
   * migration or a transfer out once it's listed, or else a withdrawal,
   * which is checked.
   */
  function openLinked() {
    const linked = $page.url.searchParams.get("tx");

    if (!linked) {
      return;
    }

    linkedDeposit = linked.toLowerCase();
    openLinkedDeposit();

    if (!linkedDeposit) {
      return;
    }

    // A migration, or a transfer out, the history or this browser has. A
    // Dusk hash may name a deposit too: whichever is listed first opens.
    if (
      $keptMigrations.some(({ hash }) => hash === linkedDeposit) ||
      /^[0-9a-f]{64}$/i.test(linked)
    ) {
      linkedTransfer = linkedDeposit;

      return;
    }

    checkLinkedWithdrawal(linked);
  }

  onMount(() => {
    void bridgeTimes.load();
    rememberedActivity = hydrateWithdrawalActivity();
    rebuildActivity();
    keptDeposits = hydrateDepositActivity();
    hydrateMigrations();

    const unsubscribeDeposits = depositActivityStore.subscribe((items) => {
      keptDeposits = items;
      filterDeposits();
    });

    const unsubscribeActivity = withdrawalActivityStore.subscribe((items) => {
      rememberedActivity = items;
      rebuildActivity();
    });
    const unsubscribeHistory = activityState.subscribe((state) => {
      void showHistoryWithdrawals(state.rows);
    });
    const unsubscribe = account.subscribe((value) => {
      currentAccount = value.address?.toLowerCase() ?? null;
      filterDeposits();

      if (currentAccount) {
        resumeDepositTracking(currentAccount);
      }

      if (observedAccount !== currentAccount) {
        observedAccount = currentAccount;
        statusRequest += 1;
        isChecking = false;
        selectedTransactionHash = null;
        txHash = "";
        indexedActivity = [];
        rebuildActivity();
        resumeWithdrawalTracking(currentAccount);
        void refreshActivity();
      }
    });

    openLinked();

    // Nothing is read again while nothing is under way.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      if (isDuskEvmUnderWay()) {
        void refreshActivity();
      }

      void follow();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      unsubscribeDeposits();
      unsubscribeActivity();
      unsubscribeHistory();
      window.clearInterval(timer);
    };
  });

  $: selectedActivity =
    activity.find((item) => item.transactionHash === selectedTransactionHash) ??
    null;
  $: selectedWithdrawal = selectedActivity;
  $: {
    const latestCheck = Math.max(
      activityLoadedAt,
      ...activity.map((item) => item.lastCheckedAt ?? 0)
    );
    lastCheckedAt = latestCheck > 0 ? new Date(latestCheck) : null;
  }
  $: canCheck = finalizationConfig.configured && !isChecking && !isSubmitting;
  $: ({ language } = $settingsStore);
  $: routeList = cardRoutes($nodeNetwork);
  $: transfers = [
    ...migrationTransfers($activityState.rows, $keptMigrations, routeList),
    ...serviceTransfers($activityState.rows, $transferArrivals, routeList),
  ];
  // Followed as soon as one is under way, as the history or this browser
  // gives it, then on the timer.
  $: underWay = toFollow(transfers)
    .map(({ hash }) => hash)
    .join(" ");
  $: if (underWay) {
    void follow();
  }
  $: if (
    linkedTransfer &&
    transfers.some(({ hash }) => hash === linkedTransfer)
  ) {
    const found = transfers.find(({ hash }) => hash === linkedTransfer);

    openTransfer = found ? `${found.kind}:${found.hash}` : null;
    openDeposit = null;
    linkedTransfer = null;
    linkedDeposit = null;
  }
  // DuskEVM's parts: only on a network that has it.
  $: hasDuskEvm =
    Boolean($nodeNetwork?.duskEvm) || finalizationConfig.configured;
  $: groups = groupBridgeActivity([
    ...transfers.map((transfer) =>
      routeTransferRow(transfer, {
        locale: language,
        time: routeTime(transfer.route, { net: $nodeNetwork }),
      })
    ),
    ...activity.map((item) =>
      withdrawalRow(item, {
        locale: language,
        time: routeTime(WITHDRAWAL, $bridgeTimes),
      })
    ),
    ...deposits.map((item) =>
      depositRow(item, {
        locale: language,
        time: routeTime(DEPOSIT, $bridgeTimes),
      })
    ),
  ]);

  function validateHashInput() {
    hashError =
      txHash.length > 0 && !isWithdrawalTxHash(txHash.trim())
        ? "Enter a 0x-prefixed 32-byte transaction hash."
        : "";
  }
</script>

<SwapCard label="Bridge activity" wide>
  <div class="swap-top" slot="top">
    <nav aria-label="Bridge and activity" class="swap-tabs">
      <a class="swap-tab" href={addBasePath("/dashboard/bridge")}>Bridge</a>
      <a
        aria-current="page"
        class="swap-tab"
        href={addBasePath("/dashboard/bridge/transactions")}>Activity</a
      >
    </nav>
  </div>

  <div class="bridge-activity" in:fade|global>
    <p class="bridge-activity__lede">
      {#if hasDuskEvm}
        Transfers between Dusk and other chains{#if currentAccount}, for DuskEVM
          account <b>{shortened(currentAccount)}</b>{/if}.
      {:else}
        Transfers between Dusk and other chains.
      {/if}
      {#if lastCheckedAt}
        <span class="bridge-activity__checked"
          >Updated {formatTimestamp(lastCheckedAt.toISOString())}</span
        >
      {/if}
    </p>

    {#if hasDuskEvm && !currentAccount}
      <div class="bridge-activity__connect">
        <p>
          Connect DuskEVM wallet to list its deposits and other withdrawals.
        </p>
        <Button
          icon={{ path: mdiWalletOutline }}
          on:click={() => modal.open()}
          size="small"
          text="Connect"
          variant="secondary"
        />
      </div>
    {/if}

    {#if hasDuskEvm && !finalizationConfig.configured}
      <Banner title="Finalization not configured" variant="warning">
        <p>Missing {finalizationConfig.missing.join(", ")}.</p>
      </Banner>
    {/if}

    {#if activityError || historyError}
      <p class="bridge-activity__note" role="status">
        DuskEVM's explorer can't be read: {activityError || historyError} The withdrawals
        remembered here are still listed.
      </p>
    {/if}

    {#if isActivityLoading && !groups.length}
      <p class="bridge-activity__note" aria-live="polite">Loading activity…</p>
    {:else if !groups.length}
      <p class="bridge-activity__note">No transfers yet.</p>
    {/if}

    {#each groups as { group, head, rows } (group)}
      <section aria-labelledby="bridge-group-{group}">
        <h2 class="bridge-activity__head" id="bridge-group-{group}">{head}</h2>
        <ul class="bridge-activity__rows">
          {#each rows as row (row.id)}
            <li class="bridge-row" class:bridge-row--open={row.id === openId}>
              <div class="bridge-row__head">
                <button
                  aria-controls={row.id === openId
                    ? `bridge-details-${row.hash}`
                    : undefined}
                  aria-expanded={row.id === openId}
                  class="bridge-row__open"
                  on:click={() => toggleRow(row)}
                  type="button"
                >
                  <span aria-hidden="true" class="bridge-row__pair"
                    ><NetworkMark id={row.from} /><Icon
                      path={mdiArrowRight}
                    /><NetworkMark id={row.to} /></span
                  >
                  <span class="bridge-row__main">
                    <span class="bridge-row__title">{row.title}</span>
                    <span class="bridge-row__line">{row.line}</span>
                  </span>
                  <span class="bridge-row__right">
                    {#if row.amount}
                      <span class="bridge-row__amount">{row.amount}</span>
                    {/if}
                    {#if row.state}
                      <span
                        class="bridge-row__state bridge-row__state--{row.group}"
                        >{row.state}</span
                      >
                    {/if}
                  </span>
                </button>
                {#if row.action}
                  <Button
                    aria-label={`${row.action === "prove" ? "Prove" : "Claim"} ${row.amount || "the withdrawal"} from DuskEVM`}
                    className="bridge-row__action"
                    on:click={() => startAction(row)}
                    size="small"
                    text={row.action === "prove" ? "Prove" : "Claim"}
                  />
                {/if}
              </div>
              {#if row.id === openId}
                <div class="bridge-row__details" id="bridge-details-{row.hash}">
                  {#if row.kind === "withdrawal"}
                    <WithdrawalLifecycle
                      {isChecking}
                      {isSubmitting}
                      {selectedWithdrawal}
                      {statusError}
                      submittedHash={selectedWithdrawal?.pendingTransactionHash ??
                        ""}
                      on:finalize={submitFinalization}
                      on:prove={submitProof}
                    />
                  {:else if row.kind === "deposit"}
                    <DepositLifecycle deposit={row.item} titled={false} />
                  {:else}
                    <RouteTransferDetails transfer={row.item} />
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if hasDuskEvm}
      <form
        class="bridge-activity__lookup"
        on:submit|preventDefault={() => {
          linkedDeposit = null;
          linkedTransfer = null;
          void checkStatus(txHash);
        }}
      >
        <label for="withdrawal-tx-hash">Find by transaction hash</label>
        <div class="bridge-activity__lookup-row">
          <Textbox
            aria-describedby={hashError
              ? "withdrawal-tx-hash-error"
              : undefined}
            aria-invalid={hashError ? "true" : undefined}
            bind:value={txHash}
            id="withdrawal-tx-hash"
            name="withdrawal-tx-hash"
            on:blur={validateHashInput}
            on:input={() => {
              if (isWithdrawalTxHash(txHash.trim())) hashError = "";
            }}
            placeholder="0x…"
          />
          <Button
            disabled={!canCheck}
            text={isChecking ? "Checking" : "Check"}
            type="submit"
            variant="secondary"
          />
        </div>
        <p class="bridge-activity__hint">
          A withdrawal's DuskEVM transaction, as its wallet shows it.
        </p>
        {#if hashError}
          <p class="field-error" id="withdrawal-tx-hash-error" role="alert">
            {hashError}
          </p>
        {/if}
      </form>
    {/if}
  </div>
</SwapCard>

<style lang="postcss">
  .bridge-activity {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0 0.5rem 0.5rem;
  }

  .bridge-activity__lede,
  .bridge-activity__note,
  .bridge-activity__hint {
    color: var(--calm-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .bridge-activity__lede b {
    color: var(--calm-text);
    font-family: var(--code-font-family);
    font-weight: 400;
  }

  .bridge-activity__checked {
    display: block;
    color: var(--calm-subtle);
    font-size: 0.8125rem;
  }

  .bridge-activity__hint {
    font-size: 0.8125rem;
  }

  .bridge-activity__connect {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    background: var(--calm-field);
    box-shadow: inset 0 0 0 1px var(--calm-line);
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .bridge-activity__head {
    margin: 0.5rem 0 0;
    padding: 0.4375rem 0.75rem;
    border-radius: 0.625rem;
    background: var(--calm-s2);
    color: var(--calm-muted);
    font-size: 0.8125rem;
    font-weight: 400;
    line-height: 1.4;
  }

  .bridge-activity__rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .bridge-row {
    border-bottom: 1px solid var(--calm-line);

    &:last-child {
      border-bottom: 0 none;
    }
  }

  .bridge-row__head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .bridge-row__open {
    all: unset;
    box-sizing: border-box;
    display: grid;
    flex: 1;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.875rem;
    min-width: 0;
    min-height: 3.75rem;
    padding: 0.75rem 0.5rem;
    border-radius: 0.75rem;
    cursor: pointer;

    &:hover .bridge-row__title {
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: -2px;
    }
  }

  .bridge-row__pair {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--calm-subtle);

    & :global(.dusk-icon) {
      width: 0.875rem;
      height: 0.875rem;
    }
  }

  .bridge-row__main,
  .bridge-row__right {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .bridge-row__right {
    align-items: flex-end;
    text-align: right;
  }

  .bridge-row__title {
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .bridge-row__line {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .bridge-row__amount {
    font-size: 0.9375rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .bridge-row__state {
    font-size: 0.8125rem;
    font-weight: 500;

    &--progress {
      color: var(--calm-pending);
    }

    &--failed {
      color: var(--calm-danger);
    }
  }

  .bridge-row__head :global(.bridge-row__action) {
    flex: 0 0 auto;
    margin-right: 0.5rem;
  }

  .bridge-row__details {
    margin: 0 0 0.75rem;
    border-radius: 1rem;
    background: var(--calm-field);
    box-shadow: inset 0 0 0 1px var(--calm-line);

    & > :global(.deposit-status) {
      padding: 1rem 1.25rem;
    }
  }

  .bridge-activity__lookup {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--calm-line);

    & label {
      font-size: 0.875rem;
      font-weight: 500;
    }
  }

  .bridge-activity__lookup-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
  }

  .field-error {
    margin: 0;
    color: var(--calm-danger);
    font-size: 0.8125rem;
  }

  /* Phones: the amount and the state under the route, as a line of their own. */
  @media (max-width: 30rem) {
    .bridge-row__open {
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0.25rem 0.75rem;
    }

    .bridge-row__right {
      grid-column: 2;
      flex-direction: row;
      align-items: baseline;
      justify-content: space-between;
    }
  }
</style>
