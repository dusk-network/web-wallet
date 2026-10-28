<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { mdiContain } from "@mdi/js";

  import bridgeTimes from "$lib/bridge/bridgeTimes";
  import { WITHDRAWAL, routeTime } from "$lib/bridge/routeTimes";
  import { withdrawalExplorerUrl } from "$lib/bridge/withdrawalActivity";
  import { loadProveNowClaim } from "$lib/bridge/withdrawals";
  import {
    WITHDRAWAL_TIMELINE_STEPS,
    withdrawalActionFailure,
    withdrawalStageProgress,
  } from "$lib/bridge/withdrawalLifecycle";
  import { Button, Icon } from "$lib/dusk/components";

  import Banner from "../Banner/Banner.svelte";
  import BridgeTimeline from "./BridgeTimeline.svelte";
  import WithdrawalHash from "./WithdrawalHash.svelte";
  import {
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

  /** When a withdrawal can be claimed if it's proved now: read for the one ready to prove. */
  export let loadProveNow = loadProveNowClaim;

  /** @type {import("$lib/bridge/claimDate").ClaimDate | null} */
  let proveNow = null;

  /** The withdrawal `proveNow` is for, or is being read for. */
  let proveNowOf = "";

  /**
   * Reads when the withdrawal can be claimed if it's proved now, once each
   * time it's shown ready to prove: the proof "Prove on Dusk" sends is the
   * one this date is for.
   *
   * @param {any} withdrawal
   */
  async function readProveNow(withdrawal) {
    const hash = withdrawal?.transactionHash ?? "";

    if (withdrawal?.stage !== "ready_to_prove" || hash === proveNowOf) {
      return;
    }

    proveNowOf = hash;
    proveNow = null;

    const claim = await loadProveNow(hash).catch(() => null);

    if (proveNowOf === hash) {
      proveNow = claim;
    }
  }

  onMount(() => {
    void bridgeTimes.load();
  });

  $: selectedStage = selectedWithdrawal?.stage ?? "submitted";
  $: selectedExplorerUrl = selectedWithdrawal
    ? withdrawalExplorerUrl(selectedWithdrawal.transactionHash)
    : null;
  $: void readProveNow(selectedWithdrawal);
  $: selectedStageMessage = stageMessage(selectedWithdrawal, {
    proveNow:
      proveNowOf === selectedWithdrawal?.transactionHash ? proveNow : null,
    time: routeTime(WITHDRAWAL, $bridgeTimes),
  });
  $: actionError = statusError || selectedWithdrawal?.actionError;
  $: actionFailure = actionError
    ? withdrawalActionFailure(selectedStage, actionError)
    : "";
</script>

<section
  class="status-pane"
  aria-live="polite"
  aria-busy={isChecking}
  bind:this={element}
>
  {#if selectedWithdrawal}
    <!-- The row above names the withdrawal and its status. -->
    <BridgeTimeline
      currentMessage={selectedStageMessage}
      progress={withdrawalStageProgress(selectedStage)}
      steps={WITHDRAWAL_TIMELINE_STEPS}
    />

    {#if actionFailure}
      <Banner title={actionFailure} variant="error" />
    {/if}

    {#if selectedWithdrawal.trackingError}
      <Banner title="Status temporarily unavailable" variant="warning">
        <p>
          The last confirmed withdrawal state is still shown. Tracking will
          retry automatically.
        </p>
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

    {#if selectedStage === "ready_to_prove" || selectedStage === "ready_to_finalize"}
      <div class="status-actions">
        {#if selectedStage === "ready_to_prove"}
          <Button
            disabled={isSubmitting}
            text={isSubmitting ? "Submitting" : "Prove on Dusk"}
            on:click={() => dispatch("prove")}
          />
        {:else}
          <Button
            disabled={isSubmitting}
            text={isSubmitting ? "Submitting" : "Claim on Dusk"}
            on:click={() => dispatch("finalize")}
          />
        {/if}
      </div>
    {/if}

    <dl class="withdrawal-details">
      <dt>Sent</dt>
      <dd>
        {formatTimestamp(
          selectedWithdrawal.sentAt ?? selectedWithdrawal.timestamp
        )}
      </dd>
      {#if selectedWithdrawal.blockNumber !== null && selectedWithdrawal.blockNumber !== undefined}
        <dt>DuskEVM block</dt>
        <dd>{selectedWithdrawal.blockNumber.toString()}</dd>
      {/if}
      <dt>DuskEVM transaction</dt>
      <dd>
        <WithdrawalHash
          href={selectedExplorerUrl}
          name="DuskEVM transaction hash"
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
