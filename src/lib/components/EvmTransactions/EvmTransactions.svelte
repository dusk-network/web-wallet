<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import {
    mdiAlertOutline,
    mdiArrowLeft,
    mdiCheck,
    mdiContain,
    mdiContentCopy,
    mdiOpenInNew,
    mdiRefresh,
    mdiWalletOutline,
  } from "@mdi/js";
  import { formatUnits } from "viem";
  import { fade } from "svelte/transition";

  import { AppAnchorButton, Banner } from "$lib/components";
  import {
    AnchorButton,
    Badge,
    Button,
    Icon,
    Textbox,
    Throbber,
  } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import {
    finalizeWithdrawal,
    getWithdrawalFinalizationConfig,
    isWithdrawalTxHash,
    loadWithdrawalStatus,
    proveWithdrawal,
  } from "$lib/bridge/withdrawals";
  import {
    loadWithdrawalActivity,
    rememberWithdrawalTransaction,
    withdrawalExplorerUrl,
    withdrawalStageLabel,
    withdrawalStageProgress,
  } from "$lib/bridge/withdrawalActivity";
  import { account, modal } from "$lib/web3/walletConnection";

  const finalizationConfig = getWithdrawalFinalizationConfig();
  const timelineSteps = [
    "Initiated",
    "Output available",
    "Prove withdrawal",
    "Challenge period",
    "Finalized",
  ];
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

  /** @type {string | null} */
  let selectedExplorerUrl = null;

  /** @type {boolean} */
  let canCheck = false;

  /** @type {number} */
  let activityRequest = 0;

  /** @type {number} */
  let statusRequest = 0;

  /** @type {string} */
  let selectedStageMessage = "";

  /** @type {HTMLElement | null} */
  let statusPaneElement = null;

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
   * @param {string} value
   */
  function shortened(value) {
    return value.length > 18
      ? `${value.slice(0, 10)}...${value.slice(-6)}`
      : value;
  }

  /**
   * @param {string | null | undefined} value
   */
  function formatTimestamp(value) {
    if (!value) {
      return "Pending";
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "Pending"
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  }

  /**
   * @param {string | null | undefined} value
   */
  function formatAmount(value) {
    if (!value || !/^\d+$/u.test(value)) {
      return null;
    }

    const [whole, decimals = ""] = formatUnits(BigInt(value), 18).split(".");
    const fraction = decimals.slice(0, 6).replace(/0+$/u, "");

    return `${whole}${fraction ? `.${fraction}` : ""} DUSK`;
  }

  /**
   * @param {any} item
   */
  function activityAmount(item) {
    return formatAmount(item?.amountWei);
  }

  /**
   * @param {string} stage
   */
  function badgeVariant(stage) {
    if (
      stage === "ready_to_prove" ||
      stage === "ready_to_finalize" ||
      stage === "finalized"
    ) {
      return "success";
    }

    if (
      stage === "submitted" ||
      stage === "waiting_for_output" ||
      stage === "prove_submitted" ||
      stage === "proven_waiting" ||
      stage === "finalize_submitted"
    ) {
      return "warning";
    }

    return "neutral";
  }

  /**
   * @param {number} step
   * @param {string} stage
   */
  function timelineState(step, stage) {
    const progress = withdrawalStageProgress(stage);

    if (progress === timelineSteps.length || step < progress) {
      return "complete";
    }

    return step === progress ? "current" : "pending";
  }

  /**
   * @param {number | bigint | string | undefined} unixTimestamp
   */
  function remainingUntilUnix(unixTimestamp) {
    if (unixTimestamp === undefined) {
      return null;
    }

    const timestamp = Number(unixTimestamp) * 1_000;

    return remainingUntil(timestamp);
  }

  /**
   * @param {string | null | undefined} timestamp
   */
  function remainingUntilTimestamp(timestamp) {
    if (!timestamp) {
      return null;
    }

    const time = new Date(timestamp).getTime();

    return Number.isNaN(time) ? null : remainingUntil(time);
  }

  /**
   * @param {number} timestamp
   */
  function remainingUntil(timestamp) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((timestamp - Date.now()) / 1_000)
    );

    if (remainingSeconds === 0) {
      return "available now";
    }

    if (remainingSeconds < 60) {
      return `in ${remainingSeconds} seconds`;
    }

    const minutes = Math.ceil(remainingSeconds / 60);

    if (minutes < 60) {
      return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }

    const hours = Math.ceil(minutes / 60);

    if (hours < 48) {
      return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
    }

    const days = Math.ceil(hours / 24);

    return `in ${days} ${days === 1 ? "day" : "days"}`;
  }

  /**
   * @param {any} item
   */
  function provenWaitingMessage(item) {
    const remaining =
      remainingUntilUnix(item.readyAt) ??
      remainingUntilTimestamp(item.challengePeriodEnd);

    if (item.statusMessage) {
      return `${item.statusMessage}${remaining ? ` Finalization is ${remaining}.` : ""}`;
    }

    return `The proof is accepted.${remaining ? ` Finalization is ${remaining}.` : " The challenge period is still active."}`;
  }

  /**
   * @param {any} item
   */
  function stageMessage(item) {
    switch (item?.stage) {
      case "submitted":
        return "Waiting for the DuskEVM transaction to be confirmed and indexed.";
      case "waiting_for_output":
        return "The withdrawal is confirmed. Waiting for an output proposal.";
      case "ready_to_prove":
        return (
          item.statusMessage ||
          "The output is available. Submit the proof on Dusk."
        );
      case "prove_submitted":
        return "The proof transaction was submitted on Dusk.";
      case "proven_waiting":
        return provenWaitingMessage(item);
      case "ready_to_finalize":
        return "The challenge period is complete. Finalize the withdrawal on Dusk.";
      case "finalize_submitted":
        return "The finalization transaction was submitted on Dusk.";
      case "finalized":
        return "The withdrawal has been finalized on Dusk.";
      default:
        return "Withdrawal status is unavailable.";
    }
  }

  /**
   * @param {string} value
   * @param {string} name
   */
  async function copyValue(value, name) {
    try {
      await navigator.clipboard.writeText(value);
      toast("success", `${name} copied`, mdiContentCopy);
    } catch (error) {
      toast("error", getErrorMessage(error), mdiAlertOutline);
    }
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
    submittedHash = "";

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
      const status = await loadWithdrawalStatus(checkedHash);

      if (
        request === statusRequest &&
        selectedActivity?.transactionHash === checkedHash
      ) {
        applyLoadedStatus(status);
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
    submittedHash = "";

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

  async function submitProof() {
    isSubmitting = true;
    statusError = "";
    submittedHash = "";

    try {
      submittedHash = await proveWithdrawal(checkedStatusTxHash());
      withdrawalStatus = {
        ...withdrawalStatus,
        stage: "prove_submitted",
      };
      updateSelectedStage("prove_submitted");
    } catch (error) {
      statusError = getErrorMessage(error);
    } finally {
      isSubmitting = false;
    }
  }

  async function submitFinalization() {
    isSubmitting = true;
    statusError = "";
    submittedHash = "";

    try {
      submittedHash = await finalizeWithdrawal(checkedStatusTxHash());
      withdrawalStatus = {
        ...withdrawalStatus,
        stage: "finalize_submitted",
      };
      updateSelectedStage("finalize_submitted");
    } catch (error) {
      statusError = getErrorMessage(error);
    } finally {
      isSubmitting = false;
    }
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

  function validateHashInput() {
    hashError =
      txHash.length > 0 && !isWithdrawalTxHash(txHash.trim())
        ? "Enter a 0x-prefixed 32-byte transaction hash."
        : "";
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
  $: selectedExplorerUrl = selectedWithdrawal
    ? withdrawalExplorerUrl(selectedWithdrawal.transactionHash)
    : null;
  $: selectedStageMessage = stageMessage(selectedWithdrawal);
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
    <section class="activity-pane" aria-labelledby="recent-withdrawals-title">
      <header class="pane-header">
        <div>
          <h4 id="recent-withdrawals-title">Recent withdrawals</h4>
          {#if lastCheckedAt}
            <p>Updated {formatTimestamp(lastCheckedAt.toISOString())}</p>
          {/if}
        </div>
      </header>

      {#if !currentAccount}
        <Banner title="Connect DuskEVM wallet" variant="info">
          <div class="connect-wallet">
            <p>Connect the originating account to load its activity.</p>
            <Button
              icon={{ path: mdiWalletOutline }}
              text="Connect"
              on:click={() => modal.open()}
            />
          </div>
        </Banner>
      {:else if activityError}
        <Banner title="Explorer unavailable" variant="warning">
          <p>{activityError} Locally remembered withdrawals are still shown.</p>
        </Banner>
      {/if}

      {#if isActivityLoading && activity.length === 0}
        <div class="transactions-list__empty" aria-live="polite">
          <Throbber />
          <p>Loading activity</p>
        </div>
      {:else if activity.length > 0}
        <ul class="activity-list">
          {#each activity as item (item.transactionHash)}
            <li>
              <button
                aria-pressed={selectedActivity?.transactionHash ===
                  item.transactionHash}
                class:activity-list__item--selected={selectedActivity?.transactionHash ===
                  item.transactionHash}
                class="activity-list__item"
                on:click={() => selectActivity(item)}
                type="button"
              >
                <span class="activity-list__primary">
                  <strong>{activityAmount(item) ?? "DUSK withdrawal"}</strong>
                  <span>{formatTimestamp(item.timestamp)}</span>
                </span>
                <span class="activity-list__status">
                  <Badge
                    text={withdrawalStageLabel(item.stage)}
                    variant={badgeVariant(item.stage)}
                  />
                  <span>{shortened(item.transactionHash)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="transactions-list__empty">
          <Icon path={mdiContain} size="large" />
          <p>No withdrawals found</p>
        </div>
      {/if}

      <form
        class="withdrawal-lookup"
        on:submit|preventDefault={() => checkStatus()}
      >
        <label for="withdrawal-tx-hash">Find by transaction hash</label>
        <div class="withdrawal-lookup__controls">
          <Textbox
            aria-describedby={hashError
              ? "withdrawal-tx-hash-error"
              : undefined}
            aria-invalid={hashError ? "true" : undefined}
            id="withdrawal-tx-hash"
            name="withdrawal-tx-hash"
            placeholder="0x..."
            bind:value={txHash}
            on:blur={validateHashInput}
            on:input={() => {
              if (isWithdrawalTxHash(txHash.trim())) hashError = "";
            }}
          />
          <Button
            disabled={!canCheck}
            text={isChecking ? "Checking" : "Check"}
            type="submit"
            variant="primary"
          />
        </div>
        {#if hashError}
          <p id="withdrawal-tx-hash-error" class="field-error" role="alert">
            {hashError}
          </p>
        {/if}
      </form>
    </section>

    <section
      class="status-pane"
      aria-live="polite"
      aria-busy={isChecking}
      bind:this={statusPaneElement}
    >
      {#if selectedWithdrawal}
        <header class="status-header">
          <div>
            <p>Withdrawal</p>
            <h4>{activityAmount(selectedWithdrawal) ?? "DUSK withdrawal"}</h4>
          </div>
          <Badge
            text={withdrawalStageLabel(selectedStage)}
            variant={badgeVariant(selectedStage)}
          />
        </header>

        <ol class="withdrawal-timeline" aria-label="Withdrawal progress">
          {#each timelineSteps as step, index (step)}
            {@const state = timelineState(index, selectedStage)}
            <li
              class={`withdrawal-timeline__step withdrawal-timeline__step--${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span class="withdrawal-timeline__marker">
                {#if state === "complete"}
                  <Icon path={mdiCheck} size="small" />
                {:else}
                  {index + 1}
                {/if}
              </span>
              <span>
                <strong>{step}</strong>
                {#if state === "current"}
                  <small>{selectedStageMessage}</small>
                {/if}
              </span>
            </li>
          {/each}
        </ol>

        {#if statusError}
          <Banner title="Status unavailable" variant="error">
            <p>{statusError}</p>
          </Banner>
        {/if}

        {#if submittedHash}
          <Banner title="Transaction submitted" variant="info">
            <div class="submitted-transaction">
              <code>{shortened(submittedHash)}</code>
              <div class="hash-actions">
                <Button
                  aria-label="Copy submitted transaction hash"
                  data-tooltip-id="main-tooltip"
                  data-tooltip-text="Copy transaction hash"
                  icon={{ path: mdiContentCopy }}
                  on:click={() => copyValue(submittedHash, "Transaction hash")}
                  variant="tertiary"
                />
                <AppAnchorButton
                  aria-label="View submitted transaction in Dusk explorer"
                  data-tooltip-id="main-tooltip"
                  data-tooltip-text="View in Dusk explorer"
                  href={`/explorer/transactions/transaction?id=${submittedHash}`}
                  icon={{ path: mdiOpenInNew }}
                  variant="tertiary"
                />
              </div>
            </div>
          </Banner>
        {/if}

        <div class="status-actions">
          {#if withdrawalStatus?.stage === "ready_to_prove"}
            <Button
              disabled={isSubmitting}
              text={isSubmitting ? "Submitting" : "Prove withdrawal"}
              on:click={submitProof}
            />
          {:else if withdrawalStatus?.stage === "ready_to_finalize"}
            <Button
              disabled={isSubmitting}
              text={isSubmitting ? "Submitting" : "Finalize withdrawal"}
              on:click={submitFinalization}
            />
          {/if}
          <Button
            disabled={isChecking || isSubmitting}
            icon={{ path: mdiRefresh }}
            text={isChecking ? "Checking" : "Refresh status"}
            on:click={refreshSelectedStatus}
            variant="secondary"
          />
        </div>

        <dl class="withdrawal-details">
          <dt>Initiated</dt>
          <dd>{formatTimestamp(selectedWithdrawal.timestamp)}</dd>
          {#if selectedWithdrawal.blockNumber !== null && selectedWithdrawal.blockNumber !== undefined}
            <dt>L2 block</dt>
            <dd>{selectedWithdrawal.blockNumber.toString()}</dd>
          {/if}
          <dt>L2 transaction</dt>
          <dd class="hash-value">
            <code>{shortened(selectedWithdrawal.transactionHash)}</code>
            <span class="hash-actions">
              <Button
                aria-label="Copy L2 transaction hash"
                data-tooltip-id="main-tooltip"
                data-tooltip-text="Copy transaction hash"
                icon={{ path: mdiContentCopy }}
                on:click={() =>
                  copyValue(
                    selectedWithdrawal.transactionHash,
                    "Transaction hash"
                  )}
                variant="tertiary"
              />
              {#if selectedExplorerUrl}
                <AnchorButton
                  aria-label="View L2 transaction in Blockscout"
                  data-tooltip-id="main-tooltip"
                  data-tooltip-text="View in Blockscout"
                  href={selectedExplorerUrl}
                  icon={{ path: mdiOpenInNew }}
                  rel="noopener noreferrer"
                  target="_blank"
                  variant="tertiary"
                />
              {/if}
            </span>
          </dd>
          {#if selectedWithdrawal.withdrawalHash}
            <dt>Withdrawal hash</dt>
            <dd class="hash-value">
              <code>{shortened(selectedWithdrawal.withdrawalHash)}</code>
              <Button
                aria-label="Copy withdrawal hash"
                data-tooltip-id="main-tooltip"
                data-tooltip-text="Copy withdrawal hash"
                icon={{ path: mdiContentCopy }}
                on:click={() =>
                  copyValue(
                    selectedWithdrawal.withdrawalHash,
                    "Withdrawal hash"
                  )}
                variant="tertiary"
              />
            </dd>
          {/if}
          {#if selectedWithdrawal.proofSubmitter}
            <dt>Proof submitter</dt>
            <dd><code>{shortened(selectedWithdrawal.proofSubmitter)}</code></dd>
          {/if}
        </dl>
      {:else}
        <div class="transactions-list__empty status-pane__empty">
          <Icon path={mdiContain} size="large" />
          <p>Select a withdrawal to view its progress</p>
        </div>
      {/if}
    </section>
  </div>
</article>

<style lang="postcss">
  .transactions {
    border-radius: 1.25em;
    background: var(--surface-color);
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

    &__header-actions,
    .hash-actions,
    .status-actions {
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

  .activity-pane,
  .status-pane {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    padding: 1.25rem;
  }

  .activity-pane {
    border-right: 1px solid var(--surface-border-color-subtle);
  }

  .pane-header,
  .status-header {
    align-items: flex-start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;

    & h4,
    & p {
      margin: 0;
    }

    & p {
      color: var(--secondary-text-color);
      font-size: 0.8125rem;
      margin-top: 0.25rem;
    }
  }

  .connect-wallet {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    & p {
      margin: 0;
    }
  }

  .activity-list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;

    & li + li {
      border-top: 1px solid var(--surface-border-color-subtle);
    }

    &__item {
      align-items: center;
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      display: grid;
      font: inherit;
      gap: 0.75rem;
      grid-template-columns: minmax(0, 1fr) auto;
      min-height: 5.25rem;
      padding: 0.875rem 0.5rem;
      text-align: left;
      width: 100%;

      &:hover,
      &:focus-visible,
      &--selected {
        background: var(--surface-hover-color);
        outline: none;
      }

      &:focus-visible {
        box-shadow: inset 0 0 0 2px var(--secondary-color);
      }
    }

    &__primary,
    &__status {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 0;
    }

    &__primary span,
    &__status > span:last-child {
      color: var(--secondary-text-color);
      font-size: 0.75rem;
    }

    &__status {
      align-items: flex-end;
      font-family: var(--mono-font-family);
      text-align: right;
    }
  }

  .withdrawal-lookup {
    border-top: 1px solid var(--surface-border-color-subtle);
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: auto;
    padding-top: 1rem;

    &__controls {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }

  .field-error {
    color: var(--error-color);
    font-size: 0.8125rem;
    margin: 0;
  }

  .status-header {
    & > div > p {
      color: var(--secondary-text-color);
      font-size: 0.75rem;
      margin: 0 0 0.25rem;
      text-transform: uppercase;
    }
  }

  .withdrawal-timeline {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;

    &__step {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1.75rem minmax(0, 1fr);
      min-height: 3.5rem;
      position: relative;

      &:not(:last-child)::before {
        background: var(--surface-border-color);
        content: "";
        height: calc(100% - 1.25rem);
        left: 0.84375rem;
        position: absolute;
        top: 1.75rem;
        width: 1px;
      }

      &--complete:not(:last-child)::before {
        background: var(--success-color);
      }

      & > span:last-child {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding-top: 0.2rem;
      }

      & small {
        color: var(--secondary-text-color);
        line-height: 1.45;
      }
    }

    &__marker {
      align-items: center;
      background: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
      border-radius: 50%;
      display: flex;
      font-family: var(--mono-font-family);
      font-size: 0.75rem;
      height: 1.75rem;
      justify-content: center;
      width: 1.75rem;
      z-index: 1;
    }

    &__step--complete &__marker {
      background: var(--status-success-bg-color);
      border-color: var(--success-color);
      color: var(--success-color);
    }

    &__step--current &__marker {
      border-color: var(--secondary-color);
      box-shadow: 0 0 0 2px var(--surface-hover-color);
      color: var(--secondary-color);
    }

    &__step--pending {
      color: var(--secondary-text-color);
    }
  }

  .submitted-transaction,
  .hash-value {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    min-width: 0;
  }

  .submitted-transaction code,
  .hash-value code {
    overflow-wrap: anywhere;
  }

  .withdrawal-details {
    border-top: 1px solid var(--surface-border-color-subtle);
    display: grid;
    gap: 0.75rem 1rem;
    grid-template-columns: max-content minmax(0, 1fr);
    margin: 0;
    padding-top: 1rem;

    & dt {
      color: var(--secondary-text-color);
      font-weight: 500;
    }

    & dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  }

  :global {
    .transactions-list__empty {
      align-items: center;
      color: var(--secondary-text-color);
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 3rem 1.5rem;
      text-align: center;
    }
  }

  .status-pane__empty {
    margin: auto;
  }

  @media (max-width: 48rem) {
    .transactions__body {
      grid-template-columns: minmax(0, 1fr);
    }

    .activity-pane {
      border-bottom: 1px solid var(--surface-border-color-subtle);
      border-right: 0;
    }
  }

  @media (max-width: 30rem) {
    .transactions__header,
    .activity-pane,
    .status-pane {
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .activity-list__item,
    .withdrawal-lookup__controls {
      grid-template-columns: minmax(0, 1fr);
    }

    .activity-list__status {
      align-items: flex-start;
      text-align: left;
    }

    .withdrawal-details {
      grid-template-columns: minmax(0, 1fr);

      & dt:not(:first-child) {
        margin-top: 0.375rem;
      }
    }
  }
</style>
