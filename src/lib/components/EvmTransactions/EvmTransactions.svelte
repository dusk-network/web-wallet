<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { mdiArrowLeft, mdiRefresh } from "@mdi/js";
  import { fade } from "svelte/transition";

  import { AppAnchorButton, Banner } from "$lib/components";
  import { Button } from "$lib/dusk/components";
  import {
    finalizeWithdrawal,
    getWithdrawalFinalizationConfig,
    isWithdrawalTxHash,
    loadDuskTransactionExecution,
    loadWithdrawalStatus,
    proveWithdrawal,
  } from "$lib/bridge/withdrawals";
  import {
    loadWithdrawalActivity,
    rememberWithdrawalTransaction,
  } from "$lib/bridge/withdrawalActivity";
  import { account } from "$lib/web3/walletConnection";

  import WithdrawalActivityList from "./WithdrawalActivityList.svelte";
  import WithdrawalLifecycle from "./WithdrawalLifecycle.svelte";
  import { shortened } from "./withdrawalPresentation";

  const finalizationConfig = getWithdrawalFinalizationConfig();
  const POLL_INTERVAL_MS = 30_000;

  /** @type {string} */
  let txHash = "";

  /** @type {any} */
  let withdrawalStatus = null;

  /** @type {any} */
  let selectedActivity = null;

  /** @type {any[]} */
  let activity = [];

  /** @type {string} */
  let statusError = "";

  /** @type {string} */
  let activityError = "";

  /** @type {string} */
  let hashError = "";

  /** @type {string} */
  let submittedHash = "";

  /** @type {Date | null} */
  let lastCheckedAt = null;

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

  /** @type {any} */
  let selectedWithdrawal = null;

  /** @type {string} */
  let selectedStage = "submitted";

  /** @type {boolean} */
  let canCheck = false;

  /** @type {number} */
  let activityRequest = 0;

  /** @type {number} */
  let statusRequest = 0;

  /** @type {HTMLElement | null} */
  let statusPaneElement = null;

  /** @type {Map<string, { action: "finalize" | "prove", hash: string, stage: string }>} */
  // This map is only read while reconciling async requests; it does not render directly.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pendingSubmissions = new Map();

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
    if (!isWithdrawalTxHash(withdrawalStatus?.transactionHash)) {
      throw new Error("Check the withdrawal status before continuing.");
    }

    return withdrawalStatus.transactionHash;
  }

  /**
   * @param {any} item
   */
  function upsertActivity(item) {
    activity = [
      item,
      ...activity.filter(
        (candidate) => candidate.transactionHash !== item.transactionHash
      ),
    ];
  }

  /**
   * @param {string} stage
   */
  function updateSelectedStage(stage) {
    if (!selectedActivity) {
      return;
    }

    selectedActivity = { ...selectedActivity, stage };
    upsertActivity(selectedActivity);
  }

  /**
   * @param {{ error: string | null, items: any[] }} result
   */
  function applyActivityResult(result) {
    activity = result.items;
    activityError = result.error ?? "";
    lastCheckedAt = new Date();
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

      if (selectedActivity) {
        const refreshed = activity.find(
          (item) => item.transactionHash === selectedActivity.transactionHash
        );

        if (refreshed) {
          selectedActivity = {
            ...refreshed,
            ...(withdrawalStatus
              ? {
                  blockNumber: withdrawalStatus.blockNumber?.toString(),
                  stage: withdrawalStatus.stage,
                }
              : {}),
          };
        }
      }
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
        withdrawalStatus = null;
      }

      return null;
    }

    if (reportValidation) {
      txHash = normalized;
      hashError = "";
    }

    statusError = "";
    submittedHash = pendingSubmissions.get(normalized)?.hash ?? "";

    return /** @type {`0x${string}`} */ (normalized);
  }

  /**
   * @param {`0x${string}`} hash
   */
  function rememberCheckedTransaction(hash) {
    const remembered = rememberWithdrawalTransaction(hash, {
      account: currentAccount,
    });

    if (
      remembered &&
      selectedActivity?.transactionHash !== remembered.transactionHash
    ) {
      selectedActivity = remembered;
      withdrawalStatus = null;
      upsertActivity(remembered);
    }
  }

  function finalizationIsConfigured() {
    if (!finalizationConfig.configured) {
      statusError = "Withdrawal finalization is not configured.";
      return false;
    }

    return true;
  }

  /**
   * @param {any} status
   */
  function applyLoadedStatus(status) {
    withdrawalStatus = status;
    lastCheckedAt = new Date();
    selectedActivity = {
      ...selectedActivity,
      blockNumber: status.blockNumber?.toString() ?? null,
      chainId: selectedActivity?.chainId,
      createdAt: selectedActivity?.createdAt ?? Date.now(),
      source: selectedActivity?.source ?? "local",
      stage: status.stage,
      transactionHash: status.transactionHash,
    };
    upsertActivity(selectedActivity);
  }

  /**
   * @param {{ action: "finalize" | "prove" }} pending
   * @param {any} status
   */
  function submissionIsReflected(pending, status) {
    if (pending.action === "finalize") {
      return status.stage === "finalized";
    }

    return (
      Boolean(status.proofSubmitter) ||
      !["ready_to_prove", "waiting_for_output"].includes(status.stage)
    );
  }

  /**
   * @param {`0x${string}`} checkedHash
   * @param {any} status
   */
  async function reconcilePendingSubmission(checkedHash, status) {
    const pending = pendingSubmissions.get(checkedHash);

    if (!pending) {
      return { status, transactionError: "" };
    }

    if (submissionIsReflected(pending, status)) {
      pendingSubmissions.delete(checkedHash);
      return { status, transactionError: "" };
    }

    let execution;

    try {
      execution = await loadDuskTransactionExecution(pending.hash);
    } catch {
      return {
        status: { ...status, stage: pending.stage },
        transactionError: "",
      };
    }

    if (!execution || !execution.error) {
      return {
        status: { ...status, stage: pending.stage },
        transactionError: "",
      };
    }

    pendingSubmissions.delete(checkedHash);

    return {
      status,
      transactionError: `${pending.action === "prove" ? "Proof" : "Finalization"} transaction failed: ${execution.error}`,
    };
  }

  /**
   * @param {`0x${string}`} checkedHash
   */
  async function loadReconciledStatus(checkedHash) {
    const status = await loadWithdrawalStatus(checkedHash);

    return await reconcilePendingSubmission(checkedHash, status);
  }

  /**
   * @param {string} [hash]
   * @param {boolean} [reportValidation]
   */
  async function checkStatus(hash = txHash, reportValidation = true) {
    const checkedHash = validatedStatusHash(hash, reportValidation);

    if (!checkedHash) return;

    rememberCheckedTransaction(checkedHash);

    if (!finalizationIsConfigured()) return;

    const request = ++statusRequest;
    isChecking = true;

    try {
      const { status, transactionError } =
        await loadReconciledStatus(checkedHash);

      if (
        request === statusRequest &&
        selectedActivity?.transactionHash === checkedHash
      ) {
        applyLoadedStatus(status);
        statusError = transactionError;
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
    selectedActivity = item;
    withdrawalStatus = null;
    txHash = item.transactionHash;
    hashError = "";
    statusError = "";
    submittedHash = pendingSubmissions.get(item.transactionHash)?.hash ?? "";

    revealSelectedWithdrawal();

    await checkStatus();
  }

  function revealSelectedWithdrawal() {
    if (!window.matchMedia("(max-width: 48rem)").matches) return;

    window.requestAnimationFrame(() => {
      statusPaneElement?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  /**
   * @param {(hash: `0x${string}`) => Promise<string>} action
   * @param {string} submittedStage
   */
  async function submitWithdrawalAction(action, submittedStage) {
    isSubmitting = true;
    statusError = "";
    submittedHash = "";

    try {
      submittedHash = await action(checkedStatusTxHash());
      pendingSubmissions.set(withdrawalStatus.transactionHash, {
        action: submittedStage === "prove_submitted" ? "prove" : "finalize",
        hash: submittedHash,
        stage: submittedStage,
      });
      withdrawalStatus = {
        ...withdrawalStatus,
        stage: submittedStage,
      };
      updateSelectedStage(submittedStage);
    } catch (error) {
      statusError = getErrorMessage(error);
    } finally {
      isSubmitting = false;
    }
  }

  function submitProof() {
    return submitWithdrawalAction(proveWithdrawal, "prove_submitted");
  }

  function submitFinalization() {
    return submitWithdrawalAction(finalizeWithdrawal, "finalize_submitted");
  }

  async function poll() {
    if (document.visibilityState === "hidden") {
      return;
    }

    await refreshActivity();

    if (
      selectedActivity &&
      selectedStage !== "finalized" &&
      !isChecking &&
      !isSubmitting
    ) {
      await checkStatus(selectedActivity.transactionHash, false);
    }
  }

  async function refreshSelectedStatus() {
    if (selectedActivity) {
      await checkStatus(selectedActivity.transactionHash, false);
    } else {
      await checkStatus();
    }
  }

  onMount(() => {
    const unsubscribe = account.subscribe((value) => {
      currentAccount = value.address?.toLowerCase() ?? null;

      if (observedAccount !== currentAccount) {
        observedAccount = currentAccount;
        statusRequest += 1;
        isChecking = false;
        selectedActivity = null;
        withdrawalStatus = null;
        pendingSubmissions.clear();
        submittedHash = "";
        txHash = "";
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
        selectedActivity = remembered;
        upsertActivity(remembered);
        revealSelectedWithdrawal();
      }

      void checkStatus();
    }

    const timer = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  });

  $: selectedWithdrawal = withdrawalStatus
    ? { ...selectedActivity, ...withdrawalStatus }
    : selectedActivity;
  $: selectedStage = selectedWithdrawal?.stage ?? "submitted";
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
      <Button
        aria-label="Refresh withdrawal activity"
        data-tooltip-id="main-tooltip"
        data-tooltip-text="Refresh activity"
        disabled={isActivityLoading || isChecking}
        icon={{ path: mdiRefresh }}
        on:click={() => poll()}
        variant="tertiary"
      />
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
      {lastCheckedAt}
      selectedTransactionHash={selectedActivity?.transactionHash ?? null}
      bind:hashError
      bind:txHash
      on:check={(event) => checkStatus(event.detail)}
      on:select={(event) => selectActivity(event.detail)}
    />
    <WithdrawalLifecycle
      {isChecking}
      {isSubmitting}
      {selectedWithdrawal}
      {statusError}
      {submittedHash}
      {withdrawalStatus}
      bind:element={statusPaneElement}
      on:finalize={submitFinalization}
      on:prove={submitProof}
      on:refresh={refreshSelectedStatus}
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
      display: grid;
      grid-template-columns: minmax(17rem, 0.85fr) minmax(0, 1.35fr);
      min-height: 32rem;
    }
  }

  @media (max-width: 48rem) {
    .transactions__body {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 30rem) {
    .transactions__header {
      padding-left: 1rem;
      padding-right: 1rem;
    }
  }
</style>
