<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { mdiArrowLeft } from "@mdi/js";
  import { fade } from "svelte/transition";

  import { AppAnchorButton, Banner } from "$lib/components";
  import {
    finalizeWithdrawal,
    getWithdrawalFinalizationConfig,
    isWithdrawalTxHash,
    proveWithdrawal,
  } from "$lib/bridge/withdrawals";
  import {
    hydrateWithdrawalActivity,
    loadWithdrawalActivity,
    mergeWithdrawalActivity,
    recordWithdrawalSubmission,
    refreshWithdrawalTransaction,
    rememberWithdrawalTransaction,
    resumeWithdrawalTracking,
    trackWithdrawalTransaction,
    withdrawalActivityStore,
  } from "$lib/bridge/withdrawalActivity";
  import { account } from "$lib/web3/walletConnection";

  import WithdrawalActivityList from "./WithdrawalActivityList.svelte";
  import { shortened } from "./withdrawalPresentation";

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

  /**
   * @param {unknown} error
   */
  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
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
        (currentAccount !== null && item.account === currentAccount)
    );
    activity = mergeWithdrawalActivity(remembered, indexedActivity);
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
        statusError = getErrorMessage(error);
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
      statusError = getErrorMessage(error);
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

  onMount(() => {
    rememberedActivity = hydrateWithdrawalActivity();
    rebuildActivity();

    const unsubscribeActivity = withdrawalActivityStore.subscribe((items) => {
      rememberedActivity = items;
      rebuildActivity();
    });
    const unsubscribe = account.subscribe((value) => {
      currentAccount = value.address?.toLowerCase() ?? null;

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

    const queryHash = $page.url.searchParams.get("tx");

    if (queryHash) {
      txHash = queryHash;
      const remembered = isWithdrawalTxHash(queryHash)
        ? rememberWithdrawalTransaction(
            /** @type {`0x${string}`} */ (queryHash),
            { account: currentAccount }
          )
        : null;

      if (remembered) {
        selectedTransactionHash = remembered.transactionHash;
      }

      void checkStatus();
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refreshActivity();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      unsubscribeActivity();
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
</script>

<article in:fade|global class="transactions">
  <header class="transactions__header">
    <div>
      <h3 class="h4">Withdrawal activity</h3>
      {#if currentAccount}
        <p>{shortened(currentAccount)}</p>
      {/if}
    </div>
    <div class="transactions__header-actions">
      <AppAnchorButton
        href="/dashboard/bridge"
        text="Back"
        variant="tertiary"
        icon={{ path: mdiArrowLeft }}
      />
    </div>
  </header>

  {#if !finalizationConfig.configured}
    <div class="transactions__notice">
      <Banner title="Finalization not configured" variant="warning">
        <p>Missing {finalizationConfig.missing.join(", ")}.</p>
      </Banner>
    </div>
  {/if}

  <div class="transactions__body">
    <WithdrawalActivityList
      {activity}
      {activityError}
      {canCheck}
      {currentAccount}
      {isActivityLoading}
      {isChecking}
      {isSubmitting}
      {lastCheckedAt}
      {selectedWithdrawal}
      {statusError}
      submittedHash={selectedWithdrawal?.pendingTransactionHash ?? ""}
      {selectedTransactionHash}
      bind:hashError
      bind:txHash
      on:check={(event) => checkStatus(event.detail)}
      on:finalize={submitFinalization}
      on:prove={submitProof}
      on:select={(event) => selectActivity(event.detail)}
    />
  </div>
</article>

<style lang="postcss">
  .transactions {
    background: var(--surface-color);
    border-radius: 1.25em;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    &__header {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: space-between;
      padding: 1.25rem;

      & h3,
      & p {
        margin: 0;
      }

      & p {
        color: var(--secondary-text-color);
        font-family: var(--mono-font-family);
        font-size: 0.8125rem;
        margin-top: 0.25rem;
      }
    }

    &__header-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    &__notice {
      padding: 0 1.25rem 1.25rem;
    }

    &__body {
      border-top: 1px solid var(--surface-border-color-subtle);
      min-height: 32rem;
    }
  }

  @media (max-width: 30rem) {
    .transactions__header {
      padding-left: 1rem;
      padding-right: 1rem;
    }
  }
</style>
