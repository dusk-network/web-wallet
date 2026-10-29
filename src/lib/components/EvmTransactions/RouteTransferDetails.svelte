<svelte:options immutable={true} />

<script>
  /**
   * A transfer between Dusk and another chain, opened from its row: when it
   * was sent and with what, where it's paid, and what paid it. A migration
   * known only by its payout says when it was paid, not when it was sent.
   */
  import { formatDuskExact } from "$lib/dusk/currency";
  import { duskExplorerTx } from "$lib/url";
  import { settingsStore } from "$lib/stores";

  import WithdrawalHash from "./WithdrawalHash.svelte";
  import { formatTimestamp } from "./withdrawalPresentation";

  /** @type {import("$lib/bridge/migrationActivity").RouteTransfer} */
  export let transfer;

  $: ({ language } = $settingsStore);
  $: ({ chain } = transfer.route);
  $: isMigration = transfer.kind === "migration";
  /** @param {string} hash A transaction on the other chain */
  const chainTx = (hash) => `${transfer.route.chain.explorerUrl}/tx/${hash}`;
</script>

<dl class="route-transfer">
  {#if transfer.at !== null}
    <dt>Sent</dt>
    <dd>
      {transfer.at
        ? formatTimestamp(new Date(transfer.at).toISOString())
        : "Not known yet"}
    </dd>
  {/if}
  <dt>{isMigration ? `${chain.name} transaction` : "Dusk transaction"}</dt>
  <dd>
    <WithdrawalHash
      explorerName={isMigration ? `${chain.name} explorer` : "Dusk explorer"}
      href={isMigration
        ? chainTx(transfer.hash)
        : duskExplorerTx(transfer.hash)}
      name={isMigration
        ? `${chain.name} transaction hash`
        : "Dusk transaction hash"}
      value={transfer.hash}
    />
  </dd>
  {#if transfer.recipient}
    <dt>{isMigration ? "To" : `${chain.name} address`}</dt>
    <dd class="route-transfer__code">{transfer.recipient}</dd>
  {/if}
  {#if !isMigration && transfer.feeLux}
    <dt>Bridge fee</dt>
    <dd>{formatDuskExact(transfer.feeLux, language)} DUSK, from the amount</dd>
  {/if}
  {#if transfer.payout}
    <dt>{isMigration ? "Paid" : "Arrived"}</dt>
    <dd>
      {formatTimestamp(
        (transfer.paidAt ?? transfer.arrivedAt)
          ? new Date(
              /** @type {number} */ (transfer.paidAt ?? transfer.arrivedAt)
            ).toISOString()
          : null
      )}
    </dd>
    <dt>{isMigration ? "Dusk payout" : `${chain.name} payout`}</dt>
    <dd>
      <WithdrawalHash
        explorerName={isMigration ? "Dusk explorer" : `${chain.name} explorer`}
        href={isMigration
          ? duskExplorerTx(transfer.payout)
          : chainTx(transfer.payout)}
        name={isMigration ? "Dusk payout hash" : `${chain.name} payout hash`}
        value={transfer.payout}
      />
    </dd>
  {/if}
</dl>

<style lang="postcss">
  .route-transfer {
    display: grid;
    gap: 0.75rem 1rem;
    grid-template-columns: max-content minmax(0, 1fr);
    margin: 0;
    padding: 1rem 1.25rem;
    font-size: 0.875rem;

    & dt {
      color: var(--calm-muted);
    }

    & dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  }

  .route-transfer__code {
    font-family: var(--mono-font-family, monospace);
  }

  @media (max-width: 30rem) {
    .route-transfer {
      grid-template-columns: minmax(0, 1fr);

      & dt:not(:first-child) {
        margin-top: 0.375rem;
      }
    }
  }
</style>
