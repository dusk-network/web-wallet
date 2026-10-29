<script>
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import { mdiContain } from "@mdi/js";

  import bridgeTimes from "$lib/bridge/bridgeTimes";
  import { WITHDRAWAL, routeTime } from "$lib/bridge/routeTimes";
  import { withdrawalExplorerUrl } from "$lib/bridge/withdrawalActivity";
  import {
    PREPARED_PROOF_MS,
    loadProveNowClaim,
  } from "$lib/bridge/withdrawals";
  import {
    WITHDRAWAL_TIMELINE_STEPS,
    withdrawalActionFailure,
    withdrawalStageProgress,
  } from "$lib/bridge/withdrawalLifecycle";
  import { Button, Icon } from "$lib/dusk/components";
  import { duskExplorerTx } from "$lib/url";
  import { duskEvm } from "$lib/web3/walletConnection";

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

  /** Whether it pays someone else: its step is then offered quietly. */
  export let quiet = false;

  /**
   * The withdrawal's proof and claim on Dusk, as the history has them.
   *
   * @type {{ claim?: string, prove?: string }}
   */
  export let duskTransactions = {};

  /** @type {{ label: string, step: "claim" | "prove" }[]} */
  const DUSK_STEPS = [
    { label: "Proof on Dusk", step: "prove" },
    { label: "Claim on Dusk", step: "claim" },
  ];

  /** When a withdrawal can be claimed if it's proved now: read for the one ready to prove. */
  export let loadProveNow = loadProveNowClaim;

  /** @type {import("$lib/bridge/claimDate").ClaimDate | null} */
  let proveNow = null;

  /** The withdrawal `proveNow` is for, or is being read for. */
  let proveNowOf = "";

  /** The reads that failed in a row. */
  let proveNowFailures = 0;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let proveNowTimer;

  /**
   * Ends the date shown as the proof it's for expires: that proof is the
   * one sent until then.
   *
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  let proveNowExpiry;

  /** The date is read again a while before the proof it's for expires. */
  const PROVE_NOW_REFRESH_MS = PREPARED_PROOF_MS - 20_000;

  /** A failed read is tried again in 5 s, then twice as long each time, up to a minute. */
  const RETRY_FIRST_MS = 5_000;
  const RETRY_MOST_MS = 60_000;

  /**
   * Follows when the withdrawal shown ready to prove can be claimed if it's
   * proved now: the proof "Prove on Dusk" sends is the one this date is for.
   *
   * @param {string} hash Its transaction while it's ready to prove, or ""
   */
  function followProveNow(hash) {
    if (hash === proveNowOf) {
      return;
    }

    clearTimeout(proveNowTimer);
    clearTimeout(proveNowExpiry);
    proveNowOf = hash;
    proveNow = null;
    proveNowFailures = 0;

    if (hash) {
      void readProveNow(hash);
    }
  }

  /**
   * Reads the date: again before the proof it's for expires, as a proof is
   * kept two minutes and a new one can be against another game; after a
   * failure, again each time after longer. A date goes as its proof
   * expires, however long the reads take meanwhile.
   *
   * @param {string} hash
   */
  async function readProveNow(hash) {
    const claim = await loadProveNow(/** @type {`0x${string}`} */ (hash)).catch(
      () => null
    );

    if (proveNowOf !== hash) {
      return;
    }

    if (claim) {
      proveNow = claim;
      proveNowFailures = 0;
      clearTimeout(proveNowExpiry);
      proveNowExpiry = setTimeout(() => {
        proveNow = null;
      }, PREPARED_PROOF_MS);
      proveNowTimer = setTimeout(
        () => readProveNow(hash),
        PROVE_NOW_REFRESH_MS
      );

      return;
    }

    proveNowFailures += 1;
    proveNowTimer = setTimeout(
      () => readProveNow(hash),
      Math.min(RETRY_FIRST_MS * 2 ** (proveNowFailures - 1), RETRY_MOST_MS)
    );
  }

  onMount(() => {
    void bridgeTimes.load();
  });

  onDestroy(() => {
    clearTimeout(proveNowTimer);
    clearTimeout(proveNowExpiry);
    proveNowOf = "";
  });

  $: selectedStage = selectedWithdrawal?.stage ?? "submitted";
  $: selectedExplorerUrl = selectedWithdrawal
    ? withdrawalExplorerUrl(selectedWithdrawal.transactionHash)
    : null;
  $: followProveNow(
    selectedWithdrawal?.stage === "ready_to_prove"
      ? (selectedWithdrawal.transactionHash ?? "")
      : ""
  );
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
          href={duskExplorerTx(submittedHash)}
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
            variant={quiet ? "secondary" : "primary"}
          />
        {:else}
          <Button
            disabled={isSubmitting}
            text={isSubmitting ? "Submitting" : "Claim on Dusk"}
            on:click={() => dispatch("finalize")}
            variant={quiet ? "secondary" : "primary"}
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
          explorerName={duskEvm.blockExplorers.default.name}
          value={selectedWithdrawal.transactionHash}
        />
      </dd>
      {#each DUSK_STEPS as { label, step } (step)}
        {@const hash = duskTransactions[step]}
        {#if hash}
          <dt>{label}</dt>
          <dd>
            <WithdrawalHash
              href={duskExplorerTx(hash)}
              name={`${label} hash`}
              explorerName="Dusk explorer"
              value={hash}
            />
          </dd>
        {/if}
      {/each}
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
    padding: 1rem 1.25rem;
  }

  .status-actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .withdrawal-details {
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
