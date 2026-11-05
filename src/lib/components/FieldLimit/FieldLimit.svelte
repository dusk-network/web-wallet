<svelte:options immutable={true} />

<script>
  /**
   * Says a field takes no more, once it's full: it would stop taking keys with
   * no word as to why.
   */

  /** What's in the field. */
  /** @type {string} */
  export let value;

  /** The most it takes, as its `maxlength`. */
  /** @type {number} */
  export let limit;
</script>

{#if value.length >= limit}
  <p class="field-limit" role="status">{limit} characters at most.</p>
{/if}

<style lang="postcss">
  .field-limit {
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }
</style>
