<script>
  import { AppAnchorButton } from "$lib/components";
  import { Button, Suspense } from "$lib/dusk/components";
  import { isHistoryEnabled } from "$lib/activity";
  import {
    CHECK_BALANCE_FIRST,
    describeFailure,
    unconfirmedHash,
  } from "$lib/transactions";

  import DepositProgress from "../EvmTransactions/DepositProgress.svelte";
  import TransactionStatus from "../TransactionStatus/TransactionStatus.svelte";

  /** @type {Promise<string>} */
  export let operation;

  /**
   * Goes back to the review, for a deposit that failed with nothing sent: Try
   * again shows only then.
   *
   * @type {(() => void) | undefined}
   */
  export let onRetry = undefined;

  /**
   * Keeps a deposit whose answer got lost, once the chain has it, as one sent:
   * its progress shows then.
   *
   * @type {(hash: string) => void}
   */
  export let onSeen = () => {};

  /** What was sent, as "0.5 DUSK to DuskEVM". */
  export let what = "";

  const hasHistory = isHistoryEnabled();

  /** Whether the chain has the deposit whose answer got lost. */
  let isSeen = false;

  /** @type {Promise<{ hash: string, unconfirmed: boolean }>} */
  let shown;

  /** @param {Error} error */
  const describe = (error) =>
    describeFailure(
      error,
      hasHistory ? {} : { checkFirst: CHECK_BALANCE_FIRST }
    );

  /**
   * What the deposit came to: its hash, or for one handed over whose answer
   * got lost, the hash it may have gone out with, followed until the chain
   * says.
   *
   * @param {Promise<string>} sent
   * @returns {Promise<{ hash: string, unconfirmed: boolean }>}
   */
  const outcomeOf = (sent) =>
    sent.then(
      (hash) => ({ hash, unconfirmed: false }),
      (error) => {
        const hash = unconfirmedHash(error);

        if (!hash) {
          throw error;
        }

        return { hash, unconfirmed: true };
      }
    );

  // Each deposit sent is followed on its own.
  $: {
    isSeen = false;
    shown = outcomeOf(operation);
  }
</script>

<Suspense
  className="deposit-result"
  describeError={describe}
  errorMessage="Deposit submission failed"
  gap="large"
  pendingMessage="Submitting on Dusk"
  waitFor={shown}
>
  <svelte:fragment
    slot="success-content"
    let:result={{ hash: transactionHash, unconfirmed }}
  >
    {#if unconfirmed && !isSeen}
      <TransactionStatus
        hash={transactionHash}
        onFinal={(outcome) => {
          if (!outcome.error) {
            onSeen(transactionHash);
            isSeen = true;
          }
        }}
        unconfirmed
        {what}
      />
      {#if hasHistory}
        <AppAnchorButton
          className="deposit-result__button"
          href={`/dashboard/transactions?tx=${transactionHash}`}
          text="See in History"
          variant="secondary"
        />
      {/if}
      <AppAnchorButton href="/dashboard" text="Home" variant="tertiary" />
    {:else}
      <DepositProgress {transactionHash} />
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="error-extra-content" let:error>
    {#if hasHistory && describe(error).outcomeUnknown}
      <AppAnchorButton
        href="/dashboard/transactions"
        text="Open History"
        variant="secondary"
      />
    {:else}
      {#if onRetry && describe(error).canRetry}
        <Button
          className="deposit-result__button"
          on:click={onRetry}
          text="Try again"
          variant="primary"
        />
      {/if}
      <AppAnchorButton href="/dashboard" text="Home" variant="tertiary" />
    {/if}
  </svelte:fragment>
</Suspense>

<style lang="postcss">
  :global {
    .deposit-result {
      padding: 1.5em 0;
      width: 100%;

      .deposit-result__button {
        width: 100%;
      }
    }

    /* A phone on its side: what follows the result above the fold. */
    @media (max-height: 30rem) {
      .deposit-result {
        padding-block: 0.5em;
      }
    }
  }
</style>
