<script>
  import { createEventDispatcher } from "svelte";
  import { mdiCheck, mdiContain, mdiRefresh } from "@mdi/js";

  import { withdrawalExplorerUrl } from "$lib/bridge/withdrawalActivity";
  import {
    WITHDRAWAL_TIMELINE_STEPS,
    withdrawalStageBadge,
    withdrawalStageLabel,
  } from "$lib/bridge/withdrawalLifecycle";
  import { Badge, Button, Icon } from "$lib/dusk/components";

  import Banner from "../Banner/Banner.svelte";
  import WithdrawalHash from "./WithdrawalHash.svelte";
  import {
    activityAmount,
    formatTimestamp,
    shortened,
    stageMessage,
    timelineState,
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

    <ol class="withdrawal-timeline" aria-label="Withdrawal progress">
      {#each WITHDRAWAL_TIMELINE_STEPS as step, index (step)}
        {@const state = timelineState(
          index,
          selectedStage,
          WITHDRAWAL_TIMELINE_STEPS.length
        )}
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
