<svelte:options immutable={true} />

<script>
  /**
   * An address in full, in the code font: its first and last six
   * characters stand out, to compare against what the recipient gave, and
   * the last six never split across lines.
   */

  /** @type {string} */
  export let address;

  /** @type {string | undefined} */
  export let className = undefined;

  $: [head, middle, tail] =
    address.length > 12
      ? [address.slice(0, 6), address.slice(6, -6), address.slice(-6)]
      : ["", address, ""];
</script>

<span class="full-address {className ?? ''}"
  ><b>{head}</b><span class="full-address__middle">{middle}</span><b
    class="full-address__tail">{tail}</b
  ></span
>

<style lang="postcss">
  .full-address {
    font-family: var(--code-font-family);
    font-size: 0.78125rem;
    line-height: 1.6;
    color: var(--calm-muted);
    overflow-wrap: anywhere;

    & b {
      color: var(--calm-text);
      font-weight: 500;
    }
  }

  .full-address__middle {
    word-break: break-all;
  }

  .full-address__tail {
    white-space: nowrap;
  }
</style>
