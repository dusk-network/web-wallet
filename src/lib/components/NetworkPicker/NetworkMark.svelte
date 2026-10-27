<svelte:options immutable={true} />

<script>
  import { mdiEthereum } from "@mdi/js";

  import { Icon } from "$lib/dusk/components";
  import { logo } from "$lib/dusk/icons";

  /** The network: "duskDs", "duskEvm", "ethereum" or "bsc". */
  /** @type {string} */
  export let id;
</script>

<span aria-hidden="true" class="network-mark">
  {#if id === "ethereum"}
    <Icon path={mdiEthereum} size="small" />
  {:else if id === "bsc"}
    <span class="network-mark__text">BNB</span>
  {:else}
    <Icon path={logo} size="small" />
    {#if id === "duskEvm"}
      <span class="network-mark__tag">EVM</span>
    {/if}
  {/if}
</span>

<style lang="postcss">
  .network-mark {
    position: relative;
    display: inline-grid;
    flex: 0 0 auto;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    background: var(--calm-s3);
    color: var(--calm-text);
  }

  .network-mark__text {
    font-size: 0.5625rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .network-mark__tag {
    position: absolute;
    right: -0.375rem;
    bottom: -0.1875rem;
    padding: 0 0.1875rem;
    border-radius: 0.25rem;
    background: var(--calm-text);
    color: var(--calm-s0);
    font-size: 0.4375rem;
    font-weight: 700;
    line-height: 0.6875rem;
  }
</style>
