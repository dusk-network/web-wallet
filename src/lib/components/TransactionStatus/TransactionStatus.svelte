<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";
  import {
    mdiAlertDecagramOutline,
    mdiCheckDecagramOutline,
    mdiTimerSand,
  } from "@mdi/js";

  import { formatFee } from "$lib/dusk/currency";
  import {
    AnchorButton,
    Button,
    ErrorDetails,
    Icon,
  } from "$lib/dusk/components";
  import { settingsStore } from "$lib/stores";
  import { followTransaction } from "$lib/transactions";

  import WithdrawalHash from "../EvmTransactions/WithdrawalHash.svelte";

  /**
   * The hash of the transaction sent, if there is one to follow.
   *
   * @type {string | undefined}
   */
  export let hash;

  /**
   * The most the transaction can cost, in Lux.
   *
   * @type {bigint}
   */
  export let maxFee;

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

  /** @type {AbortController | undefined} */
  let controller;

  /** @type {Record<Status, { icon: string, title: string }>} */
  const headings = {
    completed: { icon: mdiCheckDecagramOutline, title: "Completed" },
    failed: { icon: mdiAlertDecagramOutline, title: "Failed" },
    late: { icon: mdiTimerSand, title: "Sent" },
    pending: { icon: mdiTimerSand, title: "Sent" },
  };

  function follow() {
    controller?.abort();
    controller = new AbortController();

    const { signal } = controller;

    status = "pending";
    followTransaction(/** @type {string} */ (hash), { signal })
      .catch(() => null)
      .then((result) => {
        if (!signal.aborted) {
          outcome = result;
          status = result ? (result.error ? "failed" : "completed") : "late";
        }
      });
  }

  $: ({ language } = $settingsStore);

  onMount(() => {
    if (hash) {
      follow();
    }

    return () => controller?.abort();
  });

  $: ({ icon, title } = headings[status]);
</script>

<div class="transaction-status transaction-status--{status}">
  <div class="transaction-status__summary" role="status">
    <Icon className="transaction-status__icon" path={icon} size="large" />
    <b class="transaction-status__title">{title}</b>
    {#if !hash}
      <p>The wallet updates automatically.</p>
    {:else if status === "pending"}
      <p>Pending. This usually takes under a minute.</p>
    {:else if status === "late"}
      <p>Still pending. See its status in the explorer.</p>
    {:else if outcome && status === "completed"}
      <p>In block {outcome.blockHeight.toLocaleString()}.</p>
    {:else if outcome}
      <p>It didn't go through. The network fee was charged.</p>
    {/if}
  </div>
  {#if hash}
    <dl class="transaction-status__details">
      <dt>Transaction</dt>
      <dd>
        <WithdrawalHash name="Transaction hash" value={hash} />
      </dd>
      {#if outcome}
        <dt>Network fee</dt>
        <dd>{formatFee(outcome.fee, language)} DUSK</dd>
      {:else}
        <dt>Network fee (at most)</dt>
        <dd>{formatFee(maxFee, language, { max: true })} DUSK</dd>
      {/if}
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
