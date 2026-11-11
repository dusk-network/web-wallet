<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";
  import {
    mdiAlertDecagramOutline,
    mdiCheckDecagramOutline,
    mdiTimerSand,
  } from "@mdi/js";

  import { currentActivity } from "$lib/activity";
  import { timeLabel } from "$lib/activity/present";
  import { handOverSend, tellSendEnd } from "$lib/bridge/sendArrival";
  import { formatDuskExact, formatFee } from "$lib/dusk/currency";
  import {
    AnchorButton,
    Button,
    ErrorDetails,
    Icon,
  } from "$lib/dusk/components";
  import { settingsStore, walletStore } from "$lib/stores";
  import { followTransaction } from "$lib/transactions";

  import BalanceValue from "../BalanceValue/BalanceValue.svelte";
  import ArrivalNotice from "../Bridge/ArrivalNotice.svelte";
  import WithdrawalHash from "../EvmTransactions/WithdrawalHash.svelte";
  import MemoText from "../MemoText/MemoText.svelte";

  /**
   * The hash of the transaction sent, if there is one to follow.
   *
   * @type {string | undefined}
   */
  export let hash;

  /**
   * The most the transaction can cost, in Lux, where it's known.
   *
   * @type {bigint | undefined}
   */
  export let maxFee = undefined;

  /** What was sent and to whom, as "0.5 DUSK to Alice (alice.dusk)". */
  export let what = "";

  /** The memo it was sent with. */
  export let memo = "";

  /**
   * Whether it was handed over without an answer: it may have gone out, and
   * it says so until the chain has it.
   */
  export let unconfirmed = false;

  /**
   * Told what the chain says once the block with it is final, and the hash
   * it followed: the one it went out with, also where the send's answer got
   * lost.
   *
   * @type {(outcome: import("$lib/transactions/followTransaction").FinalTransaction, hash: string) => void}
   */
  export let onFinal = () => {};

  /**
   * More of what it did, said with its fee once it's known, as the stDUSK a
   * stake with Sozu got: each hidden with the balances, or not.
   *
   * @type {{ hidden: boolean, term: string, unit: string, value: string }[]}
   */
  export let extra = [];

  /**
   * Whether it offers to say when it arrives, as a transfer to someone:
   * once a block takes it, whoever isn't looking is told.
   */
  export let tellArrival = false;

  /**
   * Pending until the block with the transaction is final, or late
   * once the wallet stops following it.
   *
   * @typedef {"completed" | "failed" | "late" | "pending"} Status
   */

  /** @type {Status} */
  let status = "pending";

  /** @type {import("$lib/transactions/followTransaction").FinalTransaction | null} */
  let outcome = null;

  /** When the wallet saw the outcome, for a block whose time isn't known. */
  let outcomeAt = 0;

  /** @type {AbortController | undefined} */
  let controller;

  // The wallet it was sent from: nothing's said of it once another opens.
  const stillOpen = walletStore.whileOpen();

  /**
   * Sending while it isn't in a final block, then when it was sent, or
   * that it failed.
   *
   * @type {Record<Status, { icon: string, title: string }>}
   */
  const headings = {
    completed: { icon: mdiCheckDecagramOutline, title: "Sent" },
    failed: { icon: mdiAlertDecagramOutline, title: "Failed" },
    late: { icon: mdiTimerSand, title: "Sending…" },
    pending: { icon: mdiTimerSand, title: "Sending…" },
  };

  /**
   * Says it arrived, or didn't, to whoever isn't looking, as a transfer on
   * the Bridge does.
   *
   * @param {"completed" | "failed"} ended
   */
  function tellEnd(ended) {
    if (tellArrival) {
      tellSendEnd({
        failed: ended === "failed",
        hash: /** @type {string} */ (hash),
        stillOpen,
        what,
      });
    }
  }

  function follow() {
    controller?.abort();
    controller = new AbortController();

    const { signal } = controller;

    status = "pending";
    followTransaction(/** @type {string} */ (hash), {
      // Sent, or failed, as soon as a block took it: its block is final a
      // block or so later.
      onBlock: (inBlock) => {
        if (!signal.aborted && status === "pending") {
          outcome = inBlock;
          outcomeAt = Date.now();
          status = inBlock.error ? "failed" : "completed";
          tellEnd(status);
        }
      },
      signal,
    })
      .catch(() => null)
      .then((result) => {
        if (signal.aborted) {
          return;
        }

        // It's final, so History and the balances can say so as this does.
        if (result) {
          if (status === "pending") {
            tellEnd(result.error ? "failed" : "completed");
          }

          outcome = result;
          outcomeAt = Date.now();
          status = result.error ? "failed" : "completed";
          void currentActivity()?.refresh();
          void walletStore.refreshBalance();
          onFinal(result, /** @type {string} */ (hash));
        } else if (status === "pending") {
          status = "late";
        }
      });
  }

  $: ({ language } = $settingsStore);

  onMount(() => {
    if (hash) {
      follow();
    }

    return () => {
      controller?.abort();

      // Left before a block took it: the wallet tells, wherever it is.
      if (tellArrival && hash && !outcome) {
        handOverSend({ hash, stillOpen, what });
      }
    };
  });

  // Without an answer, it may not have gone out: until the chain has it.
  $: isUnconfirmed = unconfirmed && (status === "pending" || status === "late");
  $: ({ icon } = headings[status]);
  // Without a hash there's nothing to follow: it was sent.
  $: title = !hash
    ? "Sent"
    : status === "completed" && outcome
      ? `Sent at ${timeLabel(outcome.timestamp ?? outcomeAt, language, { seconds: true })}`
      : isUnconfirmed
        ? "Not confirmed"
        : headings[status].title;
</script>

<div class="transaction-status transaction-status--{status}">
  <div class="transaction-status__summary" role="status">
    <Icon className="transaction-status__icon" path={icon} size="large" />
    <b class="transaction-status__title">{title}</b>
    {#if what}
      <p class="transaction-status__what">{what}</p>
    {/if}
    {#if !hash}
      <p>The wallet updates automatically.</p>
    {:else if isUnconfirmed && status === "pending"}
      <p>
        It may have reached the network. Wait for it here before you send it
        again.
      </p>
    {:else if isUnconfirmed}
      <p>
        It isn't in a block yet. See its status in the explorer before you send
        it again.
      </p>
    {:else if status === "pending"}
      <p>This usually takes under a minute.</p>
    {:else if status === "late"}
      <p>Still pending. See its status in the explorer.</p>
    {:else if outcome && status === "completed"}
      <p>In block {outcome.blockHeight.toLocaleString()}.</p>
    {:else if outcome}
      <p>It didn't go through. The network fee was charged.</p>
    {/if}
  </div>
  {#if tellArrival && hash && status === "pending"}
    <ArrivalNotice />
  {/if}
  {#if hash}
    <dl class="transaction-status__details">
      {#if memo}
        <dt>Memo</dt>
        <dd class="transaction-status__memo"><MemoText text={memo} /></dd>
      {/if}
      <dt>Transaction</dt>
      <dd>
        <WithdrawalHash name="Transaction hash" value={hash} />
      </dd>
      {#if outcome}
        <dt>Network fee</dt>
        <dd>
          <BalanceValue value={formatDuskExact(outcome.fee, language)} /> DUSK
        </dd>
      {:else if maxFee !== undefined}
        <dt>Network fee (at most)</dt>
        <dd>
          <BalanceValue value={formatFee(maxFee, language, { max: true })} /> DUSK
        </dd>
      {/if}
      {#each extra as line (line.term)}
        <dt>{line.term}</dt>
        <dd>
          <BalanceValue
            hidden={line.hidden ? undefined : false}
            value={line.value}
          />
          {line.unit}
        </dd>
      {/each}
    </dl>
    {#if outcome?.error}
      <ErrorDetails
        className="transaction-status__error"
        error={new Error(outcome.error)}
        summary="Details"
      />
    {/if}
    <AnchorButton
      className="transaction-status__button"
      href={`/explorer/transactions/transaction?id=${hash}`}
      rel="noopener noreferrer"
      target="_blank"
      text="View in Dusk explorer"
    />
    {#if status === "late"}
      <Button
        className="transaction-status__button"
        on:click={follow}
        text="Check again"
        variant="secondary"
      />
    {/if}
  {/if}
</div>

<style lang="postcss">
  .transaction-status {
    display: flex;
    flex-direction: column;
    gap: var(--medium-gap);
    width: 100%;

    &__summary {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--small-gap);
      text-align: center;

      & p {
        margin: 0;
      }
    }

    &__what {
      font-size: 1.125rem;
      font-weight: 500;
      overflow-wrap: anywhere;
    }

    & &__memo {
      font-family: inherit;
      font-weight: 400;
    }

    &--completed :global(.transaction-status__icon) {
      color: var(--badge-success-color);
    }

    &--failed :global(.transaction-status__icon) {
      color: var(--badge-error-color);
    }

    &__details {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      align-items: center;
      gap: 0.75rem 1rem;
      margin: 0;
      padding: 1em;
      border: 1px solid var(--surface-border-color);
      border-radius: var(--control-border-radius-size);
      background-color: var(--surface-soft-color);

      & dt {
        color: var(--muted-color);
      }

      & dd {
        margin: 0;
        min-width: 0;
        font-family: var(--mono-font-family);
        font-weight: 500;
        overflow-wrap: anywhere;
        text-align: right;
      }

      & dd :global(.withdrawal-hash) {
        justify-content: flex-end;
      }
    }

    :global(.transaction-status__button) {
      width: 100%;
    }
  }

  @media (max-width: 30rem) {
    .transaction-status__details {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.25rem;

      & dd {
        text-align: left;
      }

      & dd:not(:last-child) {
        margin-bottom: 0.5rem;
      }

      & dd :global(.withdrawal-hash) {
        justify-content: space-between;
      }
    }
  }
</style>
