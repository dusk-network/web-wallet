<script>
  import { createEventDispatcher } from "svelte";
  import { mdiContain, mdiRefresh } from "@mdi/js";

  import { withdrawalExplorerUrl } from "$lib/bridge/withdrawalActivity";
  import {
    WITHDRAWAL_TIMELINE_STEPS,
    withdrawalStageBadge,
    withdrawalStageLabel,
    withdrawalStageProgress,
  } from "$lib/bridge/withdrawalLifecycle";
  import { Badge, Button, Icon } from "$lib/dusk/components";

  import Banner from "../Banner/Banner.svelte";
  import BridgeTimeline from "./BridgeTimeline.svelte";
  import WithdrawalHash from "./WithdrawalHash.svelte";
  import {
    activityAmount,
    formatTimestamp,
    shortened,
    stageMessage,
  } from "./withdrawalPresentation";

  const dispatch = createEventDispatcher();

  /** @type {HTMLElement | null} */
  export let element = null;

  /** @type {boolean} */
  export let isChecking;

  /** @type {boolean} */
  export let isSubmitting;

  /** @type {any} */
  export let selectedWithdrawal;

  /** @type {string} */
  export let statusError;

  /** @type {string} */
  export let submittedHash;

  /** @type {any} */
  export let withdrawalStatus;

  $: selectedStage = selectedWithdrawal?.stage ?? "submitted";
  $: selectedExplorerUrl = selectedWithdrawal
    ? withdrawalExplorerUrl(selectedWithdrawal.transactionHash)
    : null;
  $: selectedStageMessage = stageMessage(selectedWithdrawal);
</script>

<section
  class="status-pane"
  aria-live="polite"
  aria-busy={isChecking}
  bind:this={element}
>
  {#if selectedWithdrawal}
    <header class="status-header">
      <div>
        <p>Withdrawal</p>
        <h4>{activityAmount(selectedWithdrawal) ?? "DUSK withdrawal"}</h4>
      </div>
      <Badge
        text={withdrawalStageLabel(selectedStage)}
        variant={withdrawalStageBadge(selectedStage)}
      />
    </header>

    <BridgeTimeline
      currentMessage={selectedStageMessage}
      progress={withdrawalStageProgress(selectedStage)}
      steps={WITHDRAWAL_TIMELINE_STEPS}
    />

    {#if statusError}
      <Banner title="Status unavailable" variant="error">
        <p>{statusError}</p>
      </Banner>
    {/if}

    {#if submittedHash}
      <Banner title="Transaction submitted" variant="info">
        <WithdrawalHash
          external={false}
          href={`/explorer/transactions/transaction?id=${submittedHash}`}
          name="Submitted transaction hash"
          explorerName="Dusk explorer"
          value={submittedHash}
        />
      </Banner>
    {/if}

    <div class="status-actions">
      {#if withdrawalStatus?.stage === "ready_to_prove"}
        <Button
          disabled={isSubmitting}
          text={isSubmitting ? "Submitting" : "Prove withdrawal"}
          on:click={() => dispatch("prove")}
        />
      {:else if withdrawalStatus?.stage === "ready_to_finalize"}
        <Button
          disabled={isSubmitting}
          text={isSubmitting ? "Submitting" : "Finalize withdrawal"}
          on:click={() => dispatch("finalize")}
        />
      {/if}
      <Button
        disabled={isChecking || isSubmitting}
        icon={{ path: mdiRefresh }}
        text={isChecking ? "Checking" : "Refresh status"}
        on:click={() => dispatch("refresh")}
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
      <dd>
        <WithdrawalHash
          href={selectedExplorerUrl}
          name="L2 transaction hash"
          explorerName="Blockscout"
          value={selectedWithdrawal.transactionHash}
        />
      </dd>
      {#if selectedWithdrawal.withdrawalHash}
        <dt>Withdrawal hash</dt>
        <dd>
          <WithdrawalHash
            name="Withdrawal hash"
            value={selectedWithdrawal.withdrawalHash}
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

<style lang="postcss">
  .status-pane {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    padding: 1.25rem;
  }

  .status-header {
    align-items: flex-start;
    display: flex;
    gap: 1rem;
    justify-content: space-between;

    & h4,
    & p {
      margin: 0;
    }

    & > div > p {
      color: var(--secondary-text-color);
      font-size: 0.75rem;
      margin: 0 0 0.25rem;
      text-transform: uppercase;
    }
  }

  .status-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
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

  .transactions-list__empty {
    align-items: center;
    color: var(--secondary-text-color);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 3rem 1.5rem;
    text-align: center;
  }

  .status-pane__empty {
    margin: auto;
  }

  @media (max-width: 30rem) {
    .status-pane {
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .withdrawal-details {
      grid-template-columns: minmax(0, 1fr);

      & dt:not(:first-child) {
        margin-top: 0.375rem;
      }
    }
  }
</style>
