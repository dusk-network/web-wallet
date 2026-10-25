<svelte:options immutable={true} />

<script>
  import { Banner } from "$lib/components";
  import { getShieldedPausedMessage } from "$lib/network";
  import { networkStore, walletStore } from "$lib/stores";

  /**
   * Whether to add, when the account has a shielded
   * balance, that it stays where it is.
   *
   * @type {boolean}
   */
  export let mentionBalance = true;

  $: ({ networkName } = $networkStore);
  $: ({ balance } = $walletStore);
</script>

<Banner title={getShieldedPausedMessage(networkName)} variant="info">
  {#if mentionBalance && balance.shielded.value > 0n}
    <p>Your shielded DUSK stays where it is until they're back.</p>
  {/if}
</Banner>
