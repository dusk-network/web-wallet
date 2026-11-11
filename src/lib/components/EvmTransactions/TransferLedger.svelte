<svelte:options immutable={true} />

<script>
  /**
   * One transfer in amounts, the same in all the Dusk apps: what was sent, the
   * fees and what arrived, and the gas paid on the other chain, each to the
   * last digit, the gas to the wei as the export writes it, as far as each is
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

  /**
   * What a line is called: a migration's gas says what it paid for, the
   * approval it spent and the migration, or the migration alone.
   *
   * @param {import("@dusk-network/app-core/bridge").LedgerLine} line
   */
  const nameOf = ({ expected, key, parts }) =>
    expected
      ? "You receive"
      : parts
        ? `Gas, ${parts.includes("approval") ? "approval and migration" : "migration"}`
        : NAMES[key];
</script>

{#if ledger.lines.length}
  <dl class="transfer-ledger">
    {#each ledger.lines as line (line.key)}
      {@const { coin, exact } = line}
      <div>
        <dt>{nameOf(line)}</dt>
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
