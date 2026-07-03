<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { mdiArrowLeft, mdiContain } from "@mdi/js";
  import { fade } from "svelte/transition";

  import { AppAnchorButton, Banner } from "$lib/components";
  import { Button, Icon, Textbox, Throbber } from "$lib/dusk/components";
  import {
    finalizeWithdrawal,
    getWithdrawalFinalizationConfig,
    isWithdrawalTxHash,
    loadWithdrawalStatus,
    proveWithdrawal,
  } from "$lib/bridge/withdrawals";

  const finalizationConfig = getWithdrawalFinalizationConfig();

  /** @type {string} */
  let txHash = "";

  /** @type {any} */
  let withdrawalStatus = null;

  /** @type {string} */
  let errorMessage = "";

  /** @type {string} */
  let submittedHash = "";

  /** @type {boolean} */
  let isChecking = false;

  /** @type {boolean} */
  let isSubmitting = false;

  /**
   * @param {unknown} error
   */
  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * @returns {`0x${string}`}
   */
  function checkedTxHash() {
    return /** @type {`0x${string}`} */ (txHash);
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

  async function checkStatus() {
    if (!isWithdrawalTxHash(txHash)) {
      errorMessage = "Enter a valid DuskEVM withdrawal transaction hash.";
      withdrawalStatus = null;
      return;
    }

    isChecking = true;
    errorMessage = "";
    submittedHash = "";

    try {
      withdrawalStatus = await loadWithdrawalStatus(checkedTxHash());
    } catch (error) {
      withdrawalStatus = null;
      errorMessage = getErrorMessage(error);
    } finally {
      isChecking = false;
    }
  }

  async function submitProof() {
    isSubmitting = true;
    errorMessage = "";
    submittedHash = "";

    try {
      submittedHash = await proveWithdrawal(checkedStatusTxHash());
      withdrawalStatus = {
        ...withdrawalStatus,
        stage: "prove_submitted",
      };
    } catch (error) {
      errorMessage = getErrorMessage(error);
    } finally {
      isSubmitting = false;
    }
  }

  async function submitFinalization() {
    isSubmitting = true;
    errorMessage = "";
    submittedHash = "";

    try {
      submittedHash = await finalizeWithdrawal(checkedStatusTxHash());
      withdrawalStatus = {
        ...withdrawalStatus,
        stage: "finalize_submitted",
      };
    } catch (error) {
      errorMessage = getErrorMessage(error);
    } finally {
      isSubmitting = false;
    }
  }

  onMount(() => {
    const queryHash = $page.url.searchParams.get("tx");

    if (queryHash) {
      txHash = queryHash;
      checkStatus();
    }
  });

  $: canCheck =
    finalizationConfig.configured &&
    isWithdrawalTxHash(txHash) &&
    !isChecking &&
    !isSubmitting;
</script>

<article in:fade|global class="transactions">
  <header class="transactions__header">
    <h3 class="h4">Bridge Transactions</h3>
    <AppAnchorButton
      className="transactions__footer-button"
      href="/dashboard/bridge"
      text="Back"
      variant="tertiary"
      icon={{ path: mdiArrowLeft }}
    />
  </header>

  <div class="transactions__body">
    {#if !finalizationConfig.configured}
      <Banner title="Finalization not configured" variant="warning">
        <p>
          Missing {finalizationConfig.missing.join(", ")}.
        </p>
      </Banner>
    {/if}

    <form
      class="withdrawal-finalization"
      on:submit|preventDefault={checkStatus}
    >
      <label for="withdrawal-tx-hash">L2 withdrawal transaction hash</label>
      <Textbox
        id="withdrawal-tx-hash"
        name="withdrawal-tx-hash"
        placeholder="0x..."
        bind:value={txHash}
      />
      <Button
        disabled={!canCheck}
        text={isChecking ? "Checking" : "Check status"}
        type="submit"
        variant="primary"
      />
    </form>

    {#if isChecking}
      <div class="transactions-list__empty">
        <Throbber />
        <p>Checking withdrawal status</p>
      </div>
    {:else if errorMessage}
      <Banner title="Withdrawal status unavailable" variant="error">
        <p>{errorMessage}</p>
      </Banner>
    {:else if withdrawalStatus}
      <section class="withdrawal-status" aria-live="polite">
        <dl>
          <dt>Status</dt>
          <dd>
            {#if withdrawalStatus.stage === "wallet_required"}
              Connect wallet
            {:else if withdrawalStatus.stage === "waiting_for_output"}
              Waiting for output proposal
            {:else if withdrawalStatus.stage === "ready_to_prove"}
              Ready to prove
            {:else if withdrawalStatus.stage === "prove_submitted"}
              Proof submitted
            {:else if withdrawalStatus.stage === "proven_waiting"}
              Waiting to finalize
            {:else if withdrawalStatus.stage === "ready_to_finalize"}
              Ready to finalize
            {:else if withdrawalStatus.stage === "finalize_submitted"}
              Finalization submitted
            {:else if withdrawalStatus.stage === "finalized"}
              Finalized
            {/if}
          </dd>
          <dt>L2 block</dt>
          <dd>{withdrawalStatus.blockNumber.toString()}</dd>
          <dt>Withdrawal hash</dt>
          <dd>{withdrawalStatus.withdrawalHash}</dd>
          {#if withdrawalStatus.proofSubmitter}
            <dt>Proof submitter</dt>
            <dd>{withdrawalStatus.proofSubmitter}</dd>
          {/if}
        </dl>

        {#if submittedHash}
          <Banner title="Transaction submitted" variant="info">
            <p>{submittedHash}</p>
          </Banner>
        {/if}

        {#if withdrawalStatus.stage === "wallet_required"}
          <Banner title="Wallet required" variant="warning">
            <p>Connect the Dusk wallet that will prove this withdrawal.</p>
          </Banner>
        {:else if withdrawalStatus.stage === "waiting_for_output"}
          <Banner title="Output proposal unavailable" variant="info">
            <p>{withdrawalStatus.statusMessage}</p>
          </Banner>
        {:else if withdrawalStatus.stage === "ready_to_prove"}
          {#if withdrawalStatus.statusMessage}
            <Banner title="Proof required" variant="info">
              <p>{withdrawalStatus.statusMessage}</p>
            </Banner>
          {/if}
          <Button
            disabled={isSubmitting}
            text={isSubmitting ? "Submitting" : "Prove withdrawal"}
            on:click={submitProof}
          />
        {:else if withdrawalStatus.stage === "proven_waiting"}
          <Banner title="Finalization window" variant="info">
            <p>{withdrawalStatus.statusMessage}</p>
          </Banner>
        {:else if withdrawalStatus.stage === "ready_to_finalize"}
          <Button
            disabled={isSubmitting}
            text={isSubmitting ? "Submitting" : "Finalize withdrawal"}
            on:click={submitFinalization}
          />
        {:else if withdrawalStatus.stage === "finalized"}
          <div class="transactions-list__empty">
            <Icon path={mdiContain} size="large" />
            <p>Withdrawal finalized</p>
          </div>
        {/if}
      </section>
    {:else}
      <div class="transactions-list__empty">
        <Icon path={mdiContain} size="large" />
        <p>No withdrawal selected</p>
      </div>
    {/if}
  </div>
</article>

<style lang="postcss">
  .transactions {
    border-radius: 1.25em;
    background: var(--surface-color);
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    padding-top: 1.375em;

    &__header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 0 1rem;
      gap: 0.625rem;
      flex-wrap: wrap;

      & :global(h3) {
        line-height: 150%;
      }
    }

    &__body {
      display: flex;
      flex-direction: column;
      gap: var(--default-gap);
      padding: 0 1rem 1rem;
    }
  }

  .withdrawal-finalization,
  .withdrawal-status {
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
  }

  .withdrawal-status {
    & dl {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 0.625rem 1rem;
      margin: 0;
    }

    & dt {
      color: var(--secondary-text-color);
      font-weight: 500;
    }

    & dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  }

  :global {
    .transactions-list__empty {
      padding: 3rem 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      text-align: center;
      color: var(--secondary-text-color);
    }
  }
</style>
