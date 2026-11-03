<svelte:options immutable={true} />

<script>
  import { AnchorButton, Card } from "$lib/dusk/components";
</script>

<section class="maintenance">
  <h2 class="h1">Wallet maintenance</h2>
  <div class="maintenance">
    <Card tag="article" gap="medium">
      <p>
        Dusk web-wallet is undergoing some essential maintenance and will return
        soon. Need an alternative? Rusk wallet is our terminal wallet
        application.
      </p>
    </Card>
  </div>
  <footer class="maintenance-footer">
    <AnchorButton
      href="https://github.com/dusk-network/rusk/blob/master/rusk-wallet/src/bin/README.md"
      variant="tertiary"
      text="Rusk Wallet"
    />
  </footer>
</section>

<style lang="postcss">
  .maintenance,
  .maintenance-footer {
    display: flex;
    flex-direction: column;
  }

  .maintenance {
    gap: var(--large-gap);
  }

  .maintenance-footer {
    gap: var(--default-gap);
  }
</style>
