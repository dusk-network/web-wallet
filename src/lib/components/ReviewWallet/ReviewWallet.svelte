<script>
  /**
   * The wallet a review is from, with its profile, when there's more than
   * one wallet here: "From Wallet 2 · Profile 1". It's the wallet open as
   * the review is drawn: another wallet draws the review again.
   */
  import { networkStore, walletStore } from "$lib/stores";
  import profileLabel from "$lib/wallet/profileLabel";
  import { openWalletName } from "$lib/wallets";

  $: ({ currentProfile, profiles } = $walletStore);
  $: profile = profileLabel(
    profiles,
    currentProfile,
    $networkStore.networkName
  );
</script>

{#if $openWalletName}
  <p class="review-wallet">
    From {$openWalletName}{profile ? ` · ${profile}` : ""}
  </p>
{/if}

<style lang="postcss">
  .review-wallet {
    color: var(--calm-muted);
    font-size: 0.875rem;
    line-height: 1.4;
  }
</style>
