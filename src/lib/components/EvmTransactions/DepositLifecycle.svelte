<script>
  import { createEventDispatcher } from "svelte";
  import { mdiRefresh } from "@mdi/js";

  import {
    DEPOSIT_TIMELINE_STEPS,
    depositStageBadge,
    depositStageLabel,
    depositStageMessage,
    depositStageProgress,
    isDepositDelayed,
  } from "$lib/bridge/depositLifecycle";
  import { duskEvm } from "$lib/web3/walletConnection";
  import { Badge, Button } from "$lib/dusk/components";

  import Banner from "../Banner/Banner.svelte";
  import BridgeTimeline from "./BridgeTimeline.svelte";
  import WithdrawalHash from "./WithdrawalHash.svelte";
  import { activityAmount, formatTimestamp } from "./withdrawalPresentation";

  const dispatch = createEventDispatcher();

  /** @type {any} */
  export let deposit;

  /** @type {HTMLElement | null} */
  export let element = null;

  /** @type {boolean} */
  export let isChecking = false;

  /** @type {boolean} */
  export let showRefresh = true;

  $: l2ExplorerUrl = deposit?.l2TransactionHash
    ? `${duskEvm.blockExplorers.default.url}/tx/${deposit.l2TransactionHash}`
    : null;
  $: stageMessage = depositStageMessage(deposit);
</script>

<section
  class="deposit-status"
  aria-live="polite"
  aria-busy={isChecking}
  bind:this={element}
>
  {#if deposit}
    <header class="deposit-status__header">
      <div>
        <p>Deposit</p>
        <h4>{activityAmount(deposit) ?? "DUSK deposit"}</h4>
      </div>
      <Badge
        text={depositStageLabel(deposit)}
        variant={depositStageBadge(deposit)}
      />
    </header>

    <BridgeTimeline
      currentMessage={stageMessage}
      progress={depositStageProgress(deposit)}
      steps={DEPOSIT_TIMELINE_STEPS}
    />

    {#if deposit.stage === "completed"}
      <Banner title="Deposit available" variant="info">
        <p>{stageMessage}</p>
      </Banner>
    {:else if deposit.stage === "failed"}
      <Banner title={depositStageLabel(deposit)} variant="error">
        <p>{stageMessage}</p>
      </Banner>
    {:else if isDepositDelayed(deposit)}
      <Banner title="Deposit delayed" variant="warning">
        <p>{stageMessage}</p>
      </Banner>
    {:else if deposit.stage === "l2_pending"}
      <Banner title="Deposit in transit" variant="info">
        <p>{stageMessage}</p>
      </Banner>
    {/if}

    {#if deposit.trackingError}
      <Banner title="Status temporarily unavailable" variant="warning">
        <p>
          The last confirmed deposit state is still shown. Tracking will retry
          automatically.
        </p>
      </Banner>
    {/if}

    {#if showRefresh}
      <div class="deposit-status__actions">
        <Button
          disabled={isChecking}
          icon={{ path: mdiRefresh }}
          text={isChecking ? "Checking" : "Refresh status"}
          on:click={() => dispatch("refresh")}
          variant="secondary"
        />
      </div>
    {/if}

    <dl class="deposit-status__details">
      <dt>Submitted</dt>
      <dd>{formatTimestamp(new Date(deposit.createdAt).toISOString())}</dd>
      <dt>DuskDS transaction</dt>
      <dd>
        <WithdrawalHash
          external={false}
          href={`/explorer/transactions/transaction?id=${deposit.transactionHash}`}
          name="DuskDS transaction hash"
          explorerName="Dusk explorer"
          value={deposit.transactionHash}
        />
      </dd>
      {#if deposit.l1BlockHeight}
        <dt>DuskDS block</dt>
        <dd>{deposit.l1BlockHeight}</dd>
      {/if}
      {#if deposit.l2TransactionHash}
        <dt>DuskEVM transaction</dt>
        <dd>
          <WithdrawalHash
            href={l2ExplorerUrl}
            name="DuskEVM transaction hash"
            explorerName={duskEvm.blockExplorers.default.name}
            value={deposit.l2TransactionHash}
          />
        </dd>
      {/if}
      {#if deposit.l2BlockNumber}
        <dt>DuskEVM block</dt>
        <dd>{deposit.l2BlockNumber}</dd>
      {/if}
    </dl>
  {/if}
</section>

<style lang="postcss">
  .deposit-status {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;

    &__header {
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

    &__actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    &__details {
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
  }

  @media (max-width: 30rem) {
    .deposit-status__details {
      grid-template-columns: minmax(0, 1fr);

      & dt:not(:first-child) {
        margin-top: 0.375rem;
      }
    }
  }
</style>
