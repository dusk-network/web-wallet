<svelte:options immutable={true} />

<script>
  import { isHistoryEnabled } from "$lib/activity";
  import { Button, Suspense } from "$lib/dusk/components";
  import {
    CHECK_BALANCE_FIRST,
    describeFailure,
    unconfirmedHash,
  } from "$lib/transactions";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import TransactionStatus from "../TransactionStatus/TransactionStatus.svelte";

  /** @type {string} */
  export let errorMessage = "Transaction failed";

  /**
   * The most the transaction can cost, in Lux.
   *
   * @type {bigint}
   */
  export let maxFee;

  /** @type {Function | undefined} */
  export let onBeforeLeave = undefined;

  /** Where the link under the result leads, and what it says. */
  export let leaveHref = "/dashboard";
  export let leaveText = "Home";

  /** What was sent and to whom, as "0.5 DUSK to Alice (alice.dusk)". */
  export let what = "";

  /** The memo it was sent with. */
  export let memo = "";

  /** Whether the history can show the transaction. */
  export let hasHistory = isHistoryEnabled();

  /**
   * Goes back to the review, for a send that failed with nothing sent: Try
   * again shows only then, never where it may have gone out.
   *
   * @type {((event: MouseEvent) => void) | undefined}
   */
  export let onRetry = undefined;

  /**
   * Sends the transaction, resolving with its hash.
   *
   * @type {Promise<string | void>}
   */
  export let operation;

  function handleGoHomeClick() {
    onBeforeLeave?.();
  }

  /** @param {Error} error */
  const describe = (error) =>
    describeFailure(
      error,
      hasHistory ? {} : { checkFirst: CHECK_BALANCE_FIRST }
    );

  /**
   * What the send came to: its hash, or for one handed over whose answer got
   * lost, the hash it may have gone out with, which the screen follows until
   * the chain says. Anything else it ran into is said as a failure.
   *
   * @param {Promise<string | void>} sent
   * @returns {Promise<{ hash: string | void, unconfirmed: boolean }>}
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

  $: shown = outcomeOf(operation);
</script>

<!-- A send that failed before it went out says why in plain words, with
  its own message under Details. -->
<Suspense
  className="transaction-result"
  describeError={describe}
  {errorMessage}
  gap="large"
  pendingMessage="Processing transaction"
  waitFor={shown}
>
  <svelte:fragment slot="success-content" let:result={{ hash, unconfirmed }}>
    <TransactionStatus {hash} {maxFee} {memo} {unconfirmed} {what} />
    {#if hash && hasHistory}
      <AppAnchorButton
        className="transaction-result__button"
        href={`/dashboard/transactions?tx=${hash}`}
        on:click={handleGoHomeClick}
        text="See in History"
        variant="secondary"
      />
    {/if}
    <AppAnchorButton
      className="transaction-result__button"
      href={leaveHref}
      on:click={handleGoHomeClick}
      text={leaveText}
      variant="tertiary"
    />
  </svelte:fragment>
  <svelte:fragment slot="error-extra-content" let:error>
    <!-- Whether it went out is for History to say. -->
    {#if hasHistory && describe(error).outcomeUnknown}
      <AppAnchorButton
        className="transaction-result__button"
        href="/dashboard/transactions"
        on:click={handleGoHomeClick}
        text="Open History"
        variant="secondary"
      />
    {:else}
      {#if onRetry && describe(error).canRetry}
        <Button
          className="transaction-result__button"
          on:click={onRetry}
          text="Try again"
          variant="primary"
        />
      {/if}
      <AppAnchorButton
        className="transaction-result__button"
        href={leaveHref}
        on:click={handleGoHomeClick}
        text={leaveText}
        variant="tertiary"
      />
    {/if}
  </svelte:fragment>
</Suspense>

<style lang="postcss">
  :global {
    /* A column of its own, with the page's margins. */
    .transaction-result {
      box-sizing: border-box;
      width: min(100%, 40rem);
      margin-inline: auto;
      padding: 1.5em 1rem;

      .transaction-result__button {
        width: 100%;
      }
    }
  }
</style>
