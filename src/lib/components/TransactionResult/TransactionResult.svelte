<svelte:options immutable={true} />

<script>
  import { get, readable } from "svelte/store";

  import { isHistoryEnabled } from "$lib/activity";
  import { Button, Suspense, Throbber } from "$lib/dusk/components";
  import { settingsStore } from "$lib/stores";
  import networkReach from "$lib/stores/networkReach";
  import {
    CHECK_BALANCE_FIRST,
    broadcastsAsked,
    describeFailure,
    unconfirmedHash,
    waitingSends,
  } from "$lib/transactions";
  import {
    meanwhileKey,
    sayMeanwhile,
    sentMeanwhileChecking,
    sentMeanwhileTold,
  } from "$lib/transactions/sentMeanwhile";
  import accountNamer from "$lib/wallets/accountNamer";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import MemoText from "../MemoText/MemoText.svelte";
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

  /**
   * What says `what` as balances show at the time, for telling of its
   * arrival (TransactionStatus).
   *
   * @type {((hidden: boolean) => string) | undefined}
   */
  export let whatAs = undefined;

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

  /**
   * What `extra` will say, by its terms, said to be reading until it does.
   *
   * @type {string[]}
   */
  export let extraToCome = [];

  /**
   * What calls it off until it goes out: while the network doesn't answer,
   * or couldn't be reached, it says so with Cancel, and Home to leave it
   * waiting, as Home shows it.
   *
   * @type {import("$lib/transactions/sendGate").SendGate | undefined}
   */
  export let gate = undefined;

  /**
   * Takes it to its review, held as its account sent something else while
   * it waited, to send it too from there: Send it too does, where it's
   * given.
   *
   * @type {(() => void) | undefined}
   */
  export let onSendToo = undefined;

  /**
   * Whether what was sent isn't sent, as the node doesn't have it: not sent
   * yet, or not at all, as the person chose (TransactionStatus).
   */
  let notSent = false;

  function handleGoHomeClick() {
    onBeforeLeave?.();
  }

  /** @param {Error} error */
  const describe = (error) =>
    describeFailure(
      error,
      hasHistory ? {} : { checkFirst: CHECK_BALANCE_FIRST },
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
      },
    );

  $: shown = outcomeOf(operation);
  // Asked to broadcast since it began: it may have gone out then. Its own
  // gate says it, where it has one.
  $: askedBefore = (void operation, get(broadcastsAsked));
  // Where its gate is: open, as any, without one.
  $: gateState = gate ?? readable("open");
  // Whether it waits for the network, which it couldn't reach, to go out.
  $: gateWaits = gate?.waitsForNetwork ?? readable(false);
  // Whether it's held, as its account sent something else while it waited,
  // for the person to say whether to send it too.
  $: gateAsks = gate?.asking ?? readable(false);
  $: isHandedOver = gate
    ? $gateState !== "open"
    : $broadcastsAsked > askedBefore;
  $: isWaiting = $networkReach !== "answering" || (!isHandedOver && $gateWaits);
  // The send as it waits, held as its account sent something else
  // meanwhile, and what that was, once it's found.
  $: held = gate ? $waitingSends.find((each) => each.gate === gate) : undefined;
  $: told = sayMeanwhile(
    held?.meanwhile
      ? $sentMeanwhileTold.get(meanwhileKey(held.meanwhile))
      : null,
    held ?? { address: "", lux: 0n, memo: "" },
    {
      checking: Boolean(
        held?.meanwhile &&
        $sentMeanwhileChecking.has(meanwhileKey(held.meanwhile)),
      ),
      // The end of the flow the person started: what it says shows.
      hidden: false,
      locale: $settingsStore.language,
      nameOf: $accountNamer,
    },
  );
</script>

<!-- A send that failed before it went out says why in plain words, with
  its own message under Details. -->
<Suspense
  className="transaction-result"
  describeError={describe}
  {errorMessage}
  gap="large"
  pendingMessage="Sending"
  waitFor={shown}
>
  <svelte:fragment slot="pending-content">
    {#if !$gateAsks}
      <Throbber className="dusk-suspense__throbber" />
    {/if}
    <span class="dusk-suspense__pending-message"
      >{$gateAsks
        ? "Held: not sent yet"
        : isWaiting && gate && !isHandedOver
          ? "Waiting"
          : "Sending"}</span
    >
    <!-- Which send it is, however long its answer takes. -->
    {#if what}
      <p class="transaction-result__what">
        {what}{memo ? " · " : ""}{#if memo}<MemoText inline text={memo} />{/if}
      </p>
    {/if}
    <!-- Held until the person says, as its account sent something else
      while it waited; else said where it waits, not only on the pill: what
      it means for it. -->
    {#if $gateAsks}
      <!-- What its account sent meanwhile, from the chain, once it's found,
        and whether it's the same payment. -->
      <div class="transaction-result__waiting" role="status">
        <p>{told.title}</p>
        {#if told.memo}
          <p><MemoText inline text={told.memo} /></p>
        {/if}
        {#each told.items as item, i (i)}
          <p>
            {item.text}{#if item.memo}
              · <MemoText inline text={item.memo} />{/if}
          </p>
        {/each}
        {#if told.same}
          <p>{told.same}</p>
        {/if}
      </div>
      <!-- The two choices lead: to its review, or not at all; off while
        what its account sent is read, as the answer may be that it's this
        same payment. -->
      <Button
        className="transaction-result__button"
        disabled={told.checking}
        on:click={() => (onSendToo ? onSendToo() : gate?.sendToo())}
        text="Send it too"
        variant="primary"
      />
      <Button
        className="transaction-result__button"
        disabled={told.checking}
        on:click={() => gate?.cancel()}
        text="Don't send"
        variant="secondary"
      />
    {:else if isWaiting}
      <p class="transaction-result__waiting" role="status">
        {$networkReach === "offline"
          ? "Offline."
          : $networkReach === "silent"
            ? "The network isn't answering."
            : ""}
        {isHandedOver
          ? "It may have gone out: wait here before sending it again."
          : gate
            ? "Nothing has left your wallet yet. Goes out once the network answers."
            : "Nothing has left your wallet yet."}
      </p>
      <!-- A way back while it waits: called off, until the node is asked to
        broadcast it, or left waiting, as Home shows it. -->
      {#if gate && $gateState === "open"}
        <Button
          className="transaction-result__button"
          on:click={() => gate?.cancel()}
          text="Don't send"
          variant="secondary"
        />
      {/if}
    {/if}
    <!-- And once it may have gone out, as Home shows it on its way, whether
      or not its answer comes. -->
    {#if (isWaiting && gate) || isHandedOver || $gateAsks}
      <AppAnchorButton
        className="transaction-result__button"
        href={leaveHref}
        on:click={handleGoHomeClick}
        text={leaveText}
        variant="tertiary"
      />
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="success-content" let:result={{ hash, unconfirmed }}>
    <TransactionStatus
      bind:notSent
      {extra}
      {extraToCome}
      {hash}
      {maxFee}
      {memo}
      {onFinal}
      {tellArrival}
      {unconfirmed}
      {what}
      {whatAs}
    />
    <!-- History has nothing of one not sent. -->
    {#if hash && hasHistory && !notSent}
      <AppAnchorButton
        className="transaction-result__button"
        href={`/dashboard/transactions?tx=${hash}`}
        on:click={handleGoHomeClick}
        text="See in Activity"
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
        text="Open Activity"
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

        & p {
          margin: 0;
          overflow-wrap: anywhere;
        }
      }

      .transaction-result__what {
        margin: 0;
        overflow-wrap: anywhere;
        text-align: center;
      }
    }

    /* A phone on its side: what follows the result above the fold. */
    @media (max-height: 30rem) {
      .transaction-result {
        padding-block: 0.5em;
      }
    }
  }
</style>
