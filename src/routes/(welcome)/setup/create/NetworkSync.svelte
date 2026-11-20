<svelte:options immutable={true} />

<script>
  import { CopyField } from "$lib/components";
  import { Card } from "$lib/dusk/components";
  import { createNumberFormatter } from "$lib/dusk/number";
  import { settingsStore } from "$lib/stores";

  /** @type {bigint} */
  export let currentBlockHeight;

  const numberFormatter = createNumberFormatter($settingsStore.language);
</script>

<Card>
  <!-- For experts: where the wallet starts, which Settings keeps too. -->
  <details class="network-sync__advanced">
    <summary>Advanced</summary>
    <div class="network-sync__advanced-content">
      <CopyField
        name="Starts at block"
        displayValue={numberFormatter(currentBlockHeight)}
        rawValue={String(currentBlockHeight)}
      />
      <small>Restore from this block to sync faster.</small>
    </div>
  </details>
</Card>

<style lang="postcss">
  .network-sync__advanced {
    & summary {
      padding: 0.6875em 0;
      cursor: pointer;
      font-weight: 500;
    }

    &-content {
      display: flex;
      flex-direction: column;
      gap: var(--small-gap);
    }
  }
</style>
