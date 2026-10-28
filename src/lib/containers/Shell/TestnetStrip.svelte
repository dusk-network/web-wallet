<script>
  import { networkStore } from "$lib/stores";

  import { isTestNetwork, networkLabel } from "./navigation";

  $: ({ networkName } = $networkStore);
</script>

<!-- On a test network the wallet says so at the top, as the bridge does. -->
{#if isTestNetwork(networkName)}
  <div class="testnet-strip" role="note">
    {networkLabel(networkName)}
    <span aria-hidden="true" class="testnet-strip__separator">·</span>
    Test DUSK has no value
  </div>
{/if}

<style lang="postcss">
  /* One line of a set height: the shell's offsets count it (--strip-height). */
  .testnet-strip {
    box-sizing: border-box;
    height: 2.1875rem;
    padding: 0 1rem;
    overflow: hidden;
    border-bottom: 1px solid var(--calm-test-line);
    background: var(--calm-test-bg);
    color: var(--calm-test);
    font-size: 0.84375rem;
    font-weight: 500;
    line-height: 2.125rem;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .testnet-strip__separator {
    margin: 0 0.375rem;
    opacity: 0.5;
  }

  /* On the welcome card: the full width of its top edge. */
  :global(.welcome-layout__strip) .testnet-strip {
    margin: -1rem -1rem 0;
  }
</style>
