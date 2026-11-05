<svelte:options immutable={true} />

<script>
  /**
   * One transfer in amounts, to the last digit, the same in all the Dusk apps:
   * what was sent, the fees, what arrived and the gas paid on the other chain,
   * as far as each is known.
   */
  import BalanceValue from "../BalanceValue/BalanceValue.svelte";

  /** @type {import("@dusk-network/app-core/bridge").TransferLedger} */
  export let ledger;

  /** @type {Record<string, string>} */
  const NAMES = {
    bridgeFee: "Bridge fee",
    gas: "Gas",
    networkFee: "Network fee",
    received: "Received",
    sent: "Sent",
  };
</script>

{#if ledger.lines.length}
  <dl class="transfer-ledger">
    {#each ledger.lines as { coin, exact, expected, key } (key)}
      <div>
        <dt>{expected ? "You receive" : NAMES[key]}</dt>
        <dd><BalanceValue value={exact} /> {coin}</dd>
      </div>
    {/each}
  </dl>
{/if}

<style lang="postcss">
  .transfer-ledger {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 1rem 1.25rem 0;
    font-size: 0.875rem;

    & div {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0 1rem;
    }

    & dt {
      color: var(--calm-muted);
    }

    & dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
  }
</style>
