<svelte:options immutable={true} />

<script>
  /** @type {string} */
  export let label;

  /**
   * The formatted amount, in `unit`.
   *
   * @type {string}
   */
  export let value;

  /** What it's counted in: DUSK, or a token of another chain's. */
  export let unit = "DUSK";
</script>

<dl class="review-amount">
  <dt>{label}</dt>
  <dd class="review-amount__value">{value} {unit}</dd>
</dl>

<style lang="postcss">
  .review-amount {
    display: flex;
    flex-direction: column;
    gap: 0.625em;

    &__value {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
  }
</style>
