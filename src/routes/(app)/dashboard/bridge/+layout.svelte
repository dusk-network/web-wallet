<script>
  import { WalletConnectionGate } from "$lib/components";
  import { recordsKeptHere } from "$lib/wallets/dataNames";
</script>

{#if !$recordsKeptHere}
  <p class="bridge-unkept">
    This browser's storage is full, so new Bridge activity isn't kept here.
  </p>
{/if}

<!-- The bridge's pages, and only they, start the EVM wallet connection. -->
<WalletConnectionGate>
  <slot />
</WalletConnectionGate>

<style lang="postcss">
  .bridge-unkept {
    width: min(100%, 30rem);
    margin: 1rem auto 0;
    padding: 0 1rem;
    color: var(--calm-text);
  }
</style>
