<svelte:options immutable={true} />

<script>
  import { Suspense } from "$lib/dusk/components";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import TransactionStatus from "../TransactionStatus/TransactionStatus.svelte";

  /** @type {string} */
  export let errorMessage = "Transaction failed";

  /** @type {(amount: number) => string} */
  export let formatter;

  /**
   * The most the transaction can cost, in Lux.
   *
   * @type {bigint}
   */
  export let maxFee;

  /** @type {Function | undefined} */
  export let onBeforeLeave = undefined;

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
    <TransactionStatus {formatter} {hash} {maxFee} />
    <AppAnchorButton
      className="transaction-result__button"
      href="/dashboard"
      on:click={handleGoHomeClick}
      text="Home"
      variant="tertiary"
    />
  </svelte:fragment>
  <AppAnchorButton
    className="transaction-result__button"
    href="/dashboard"
    on:click={handleGoHomeClick}
    slot="error-extra-content"
    text="Home"
    variant="tertiary"
  />
</Suspense>

<style lang="postcss">
  :global {
    .transaction-result {
      padding: 1.5em 0;

      .transaction-result__button {
        width: 100%;
      }
    }
  }
</style>
