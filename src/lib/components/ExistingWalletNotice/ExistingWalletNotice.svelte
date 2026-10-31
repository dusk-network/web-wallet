<script>
  import { Button } from "$lib/dusk/components";
  import { AppAnchorButton } from "$lib/components";
  import { WarningCard } from "$lib/containers/Cards";

  /** @type {boolean} */
  export let notice = false;
</script>

<section>
  <WarningCard heading="Existing Wallet Detected">
    <p>
      This removes every recovery phrase on this device, with each wallet's
      cache, contacts and activity. Your funds stay on Dusk. Make sure you have
      each recovery phrase saved: it's the only way back into its wallet.
    </p>
    <div class="actions">
      <AppAnchorButton
        className="actions__action"
        href="/setup"
        text="Back"
        variant="tertiary"
      />
      <Button
        className="actions__action"
        text="Proceed"
        on:click={() => {
          notice = true;
        }}
      />
    </div>
  </WarningCard>
</section>

<style lang="postcss">
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: var(--default-gap);
    gap: var(--default-gap);
  }

  :global(.actions__action) {
    flex: 1;
  }
</style>
