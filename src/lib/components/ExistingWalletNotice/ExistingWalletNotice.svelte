<script>
  import { Button } from "$lib/dusk/components";
  import { AppAnchorButton } from "$lib/components";
  import { WarningCard } from "$lib/containers/Cards";
  import vault from "$lib/vault";

  /** @type {boolean} */
  export let notice = false;

  // With more than one wallet here, Settings' Reset says the same.
  const many = (vault.list()?.length ?? 0) > 1;
</script>

<section>
  <WarningCard heading="Existing Wallet Detected">
    {#if many}
      <p>
        Removes every wallet from this browser, with its settings and contacts.
        Your funds stay on Dusk. You need each wallet's recovery phrase to get
        back in.
      </p>
    {:else}
      <p>
        Initializing a new wallet will replace your existing local wallet cache,
        erasing any stored data. Ensure you have securely backed up your current
        wallet's recovery phrase to prevent loss. Proceeding without a backup
        can lead to irreversible loss of access to your assets.
      </p>
    {/if}
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
