<svelte:options immutable={true} />

<script>
  import { get } from "svelte/store";

  import { isHistoryEnabled } from "$lib/activity";
  import { Button, Suspense, Throbber } from "$lib/dusk/components";
  import networkReach from "$lib/stores/networkReach";
  import {
    CHECK_BALANCE_FIRST,
    broadcastsAsked,
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

  /** Whether it offers to say when it arrives, as a transfer to someone. */
  export let tellArrival = false;

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

  /**
   * Told what the chain says once the block with it is final, and its hash:
   * the one it went out with, also where the send's answer got lost.
   *
   * @type {(outcome: import("$lib/transactions/followTransaction").FinalTransaction, hash: string) => void}
   */
  export let onFinal = () => {};

  /**
   * More of what it did, said with its fee once it's known.
   *
   * @type {{ hidden: boolean, term: string, unit: string, value: string }[]}
   */
  export let extra = [];

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
  // Asked to broadcast since it began: it may have gone out then.
  $: askedBefore = (void operation, get(broadcastsAsked));
  $: isHandedOver = $broadcastsAsked > askedBefore;
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
  <svelte:fragment slot="pending-content">
    <Throbber className="dusk-suspense__throbber" />
    <span class="dusk-suspense__pending-message">Processing transaction</span>
    <!-- Said where it waits, not only on the pill: what it means for it. -->
    {#if $networkReach !== "answering"}
      <p class="transaction-result__waiting" role="status">
        {$networkReach === "offline"
          ? "You're offline."
          : "The network isn't answering."}
        {isHandedOver
          ? "Your transaction may have reached it: wait for it here before you send it again."
          : "Nothing has left your wallet yet."}
      </p>
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="success-content" let:result={{ hash, unconfirmed }}>
    <TransactionStatus
      {extra}
      {hash}
      {maxFee}
      {memo}
      {onFinal}
      {tellArrival}
      {unconfirmed}
      {what}
    />
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

      .transaction-result__waiting {
        margin: 0;
        text-align: center;
      }
    }
  }
</style>
