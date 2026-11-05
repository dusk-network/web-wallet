<svelte:options immutable={true} />

<script>
  /**
   * One transfer in amounts, the same in all the Dusk apps: what was sent, the
   * fees and what arrived, to the last digit, and the gas paid on the other
   * chain, short as other wallets write it, in full on hover, as far as each is
   * known.
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
    {#each ledger.lines as { coin, exact, expected, key, text } (key)}
      <div>
        <dt>{expected ? "You receive" : NAMES[key]}</dt>
        <dd>
          {#if key === "gas"}
            <BalanceValue {exact} value={text} />
          {:else}
            <BalanceValue value={exact} />
          {/if}
          {coin}
        </dd>
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
