<script>
  import { compose, take } from "lamb";
  import { mdiArrowLeft, mdiContain } from "@mdi/js";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import {
    Anchor,
    Badge,
    Icon,
    Suspense,
    Throbber,
  } from "$lib/dusk/components";
  import {
    createFeeFormatter,
    createTransferFormatter,
  } from "$lib/dusk/currency";
  import { calculateAdaptiveCharCount, middleEllipsis } from "$lib/dusk/string";
  import { sortByHeightDesc } from "$lib/transactions";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";

  /** @type {String} */
  export let language;

  /** @type {Number | Undefined} */
  export let limit = undefined;

  const transferFormatter = createTransferFormatter(language);
  const feeFormatter = createFeeFormatter(language);

  /** @type {Promise<Transaction[]>} */
  export let items;

  /** @type {Boolean}*/
  export let isSyncing;

  /** @type {Error|null}*/
  export let syncError;

  /** @type {Number} */
  let screenWidth = window.innerWidth;

  /** @type {(transactions: Transaction[]) => Transaction[]} */
  const getOrderedTransactions = limit
    ? compose(take(limit), sortByHeightDesc)
    : sortByHeightDesc;

  onMount(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      screenWidth = entry.contentRect.width;
    });

    resizeObserver.observe(document.body);

    return () => resizeObserver.disconnect();
  });
</script>

<article in:fade|global class="transactions">
  <header class="transactions__header">
    <h3 class="h4">Transactions</h3>
    {#if limit}
      <AppAnchorButton
        className="transactions__footer-button"
        href="/dashboard/transactions"
        text="All transactions"
        variant="primary"
      />
    {:else}
      <AppAnchorButton
        className="transactions__footer-button"
        href="/dashboard"
        text="Back"
        variant="tertiary"
        icon={{ path: mdiArrowLeft }}
      />
    {/if}
  </header>
  <Suspense
    className="transactions-list__container"
    errorMessage="Error getting transactions"
    errorVariant="details"
    waitFor={items}
  >
    <svelte:fragment slot="pending-content">
      <div class="transactions-list__loading-container">
        {#if !isSyncing && !syncError}
          <Throbber />
        {:else}
          <p>Data will load after a successful sync.</p>
        {/if}
      </div>
    </svelte:fragment>
    <svelte:fragment slot="success-content" let:result={transactions}>
      {#if transactions.length}
        {#each getOrderedTransactions(transactions) as transaction (transaction.id)}
          <dl class="transactions-list">
            <dt class="transactions-list__term">Hash</dt>
            <dd class="transactions-list__datum">
              <samp>
                <Anchor
                  href="/explorer/transactions/transaction?id={transaction.id}"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {middleEllipsis(
                    transaction.id,
                    calculateAdaptiveCharCount(screenWidth, 320, 640, 5, 20)
                  )}
                </Anchor>
              </samp>
            </dd>
            {#if transaction.tx_type}
              <dt class="transactions-list__term">Type</dt>
              <dd class="transactions-list__datum">
                <Badge
                  className="transactions-list__badge"
                  text={transaction.tx_type}
                />
              </dd>
            {/if}
            <dt class="transactions-list__term">Block</dt>
            <dd class="transactions-list__datum">
              {new Intl.NumberFormat(language).format(transaction.block_height)}
            </dd>
            <dt class="transactions-list__term">Amount</dt>
            <dd class="transactions-list__datum">
              {transferFormatter(transaction.amount)}
              <span class="transactions-list__ticker">Dusk</span>
            </dd>
            {#if transaction.direction === "Out"}
              <dt class="transactions-list__term">Fee</dt>
              <dd class="transactions-list__datum">
                {feeFormatter(transaction.fee)}
                <span class="transactions-list__ticker">Dusk</span>
              </dd>
            {/if}
          </dl>
        {/each}
      {:else}
        <div class="transactions-list__empty">
          <Icon path={mdiContain} size="large" />
          <p>You have no transaction history</p>
        </div>
      {/if}
    </svelte:fragment>
  </Suspense>
</article>

<style lang="postcss">
  .transactions {
    border: 1px solid
      var(--surface-border-color);
    border-radius: var(--control-border-radius-size);
    background: var(--surface-color);
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    padding-top: 1rem;

    &__header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 0 1rem;
      gap: 0.625rem;
      flex-wrap: wrap;

      & :global(h3) {
        font-family: var(--mono-font-family);
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.12em;
        line-height: 1.2;
        text-transform: uppercase;
      }

      & :global(h3)::before {
        content: "[ ";
        color: var(--secondary-color);
      }

      & :global(h3)::after {
        content: " ]";
        color: var(--secondary-color);
      }
    }
  }

  :global {
    .transactions-list {
      display: grid;
      grid-template-columns: minmax(4.75rem, max-content) minmax(0, 1fr);
      width: 100%;
      border-top: 1px solid var(--surface-border-color-subtle);
      row-gap: 0;

      &__term {
        background-color: transparent;
        color: var(--muted-color);
        font-family: var(--mono-font-family);
        font-size: 0.72rem;
        grid-column: 1;
        line-height: 1.5;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 0.4rem 0.75rem 0.4rem 1rem;
        align-self: center;
      }

      &__ticker {
        text-transform: uppercase;
      }

      &__loading-container {
        margin: 1.25em 0;
      }

      &__datum {
        grid-column: 2;
        line-height: 1.5;
        padding: 0.4rem 1rem 0.4rem 0.75rem;
        display: flex;
        align-items: center;
        gap: 0.625em;
        font-family: var(--mono-font-family);
        overflow: hidden;
        min-width: 0;

        & samp {
          display: block;
          white-space: nowrap;
          overflow: hidden;
        }
      }

      &__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5em;
        margin: 1.25em 0;
      }

      &__badge {
        flex: 0 1 auto;
      }
    }
  }
</style>
