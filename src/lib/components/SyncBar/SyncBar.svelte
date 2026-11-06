<script>
  import { ProgressBar } from "$lib/dusk/components";
  import { settingsStore } from "$lib/stores";

  /** @type {bigint} */
  export let from;
  /** @type {bigint} */
  export let last;
  /** @type {number} */
  export let progress;

  $: ({ language } = $settingsStore);
</script>

<!-- The blocks it syncs, said: no bare numbers. -->
<div class="sync-bar">
  <ProgressBar currentPercentage={progress * 100} />
  <p class="sync-bar__blocks">
    <span>From block {from.toLocaleString(language)}</span>
    <span>to {last.toLocaleString(language)}</span>
  </p>
</div>

<style>
  .sync-bar {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
  }

  .sync-bar__blocks {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 0.5rem;
    margin: 0;
    color: var(--calm-muted);
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }
</style>
