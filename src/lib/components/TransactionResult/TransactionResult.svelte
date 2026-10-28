<svelte:options immutable={true} />

<script>
  import { isHistoryEnabled } from "$lib/activity";
  import { Suspense } from "$lib/dusk/components";

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
   * Sends the transaction, resolving with its hash.
   *
   * @type {Promise<string | void>}
   */
  export let operation;

  function handleGoHomeClick() {
    onBeforeLeave?.();
  }
</script>

<Suspense
  className="transaction-result"
  {errorMessage}
  gap="large"
  pendingMessage="Processing transaction"
  waitFor={operation}
>
  <svelte:fragment slot="success-content" let:result={hash}>
    <TransactionStatus {hash} {maxFee} {memo} {what} />
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
  <AppAnchorButton
    className="transaction-result__button"
    href={leaveHref}
    on:click={handleGoHomeClick}
    slot="error-extra-content"
    text={leaveText}
    variant="tertiary"
  />
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
