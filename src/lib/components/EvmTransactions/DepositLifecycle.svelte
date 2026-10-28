<script>
  import { onMount } from "svelte";

  import bridgeTimes from "$lib/bridge/bridgeTimes";
  import { DEPOSIT, routeTime } from "$lib/bridge/routeTimes";
  import {
    DEPOSIT_TIMELINE_STEPS,
    depositStageBadge,
    depositStageLabel,
    depositStageMessage,
    depositStageProgress,
    isDepositDelayed,
    isDepositStalled,
  } from "$lib/bridge/depositLifecycle";
  import { duskEvm } from "$lib/web3/walletConnection";
  import { Badge } from "$lib/dusk/components";

  import Banner from "../Banner/Banner.svelte";
  import BridgeTimeline from "./BridgeTimeline.svelte";
  import WithdrawalHash from "./WithdrawalHash.svelte";
  import { activityAmount, formatTimestamp } from "./withdrawalPresentation";

  /** @type {any} */
  export let deposit;

  /** @type {HTMLElement | null} */
  export let element = null;

  /** Heads the steps with the amount and the state, unless a row says them. */
  export let titled = true;

  $: l2ExplorerUrl = deposit?.l2TransactionHash
    ? `${duskEvm.blockExplorers.default.url}/tx/${deposit.l2TransactionHash}`
    : null;
  // How long a deposit takes on this network, where it's known.
  $: stageMessage = depositStageMessage(deposit, {
    time: routeTime(DEPOSIT, $bridgeTimes),
  });

  onMount(() => {
    void bridgeTimes.load();
  });
</script>

<section class="deposit-status" aria-live="polite" bind:this={element}>
  {#if deposit}
    {#if titled}
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
    {/if}

    <BridgeTimeline
      currentMessage={stageMessage}
      progress={depositStageProgress(deposit)}
      steps={DEPOSIT_TIMELINE_STEPS}
    />

    <!-- The timeline says what's happening; a banner only what went wrong. -->
    {#if deposit.stage === "failed"}
      <Banner title={depositStageLabel(deposit)} variant="error" />
    {:else if isDepositStalled(deposit) || isDepositDelayed(deposit)}
      <Banner
        title={isDepositStalled(deposit)
          ? "Deposit tracking delayed"
          : "Deposit delayed"}
        variant="warning"
      />
    {/if}

    {#if deposit.trackingError}
      <Banner title="Status unavailable. Trying again." variant="warning" />
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
        font-size: 0.8125rem;
        margin: 0 0 0.25rem;
      }
    }

    &__details {
      border-top: 1px solid var(--calm-line);
      display: grid;
      gap: 0.75rem 1rem;
      grid-template-columns: max-content minmax(0, 1fr);
      margin: 0;
      padding-top: 1rem;
      font-size: 0.875rem;

      & dt {
        color: var(--calm-muted);
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
