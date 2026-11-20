<script>
  import { Button } from "$lib/dusk/components";
  import { AppAnchorButton } from "$lib/components";
  import { WarningCard } from "$lib/containers/Cards";
  import vault from "$lib/vault";

  /** @type {boolean} */
  export let notice = false;

  /**
   * What goes on past the notice, which its button names.
   *
   * @type {"create" | "restore"}
   */
  export let flow = "restore";

  // With more than one wallet here, whichever password opens each,
  // Settings' Reset says the same.
  let many = (vault.list()?.length ?? 0) > 1;

  vault.count().then(
    (count) => {
      many = count > 1;
    },
    () => {},
  );
</script>

<section>
  <WarningCard
    heading={many ? "This browser has wallets" : "This browser has a wallet"}
  >
    {#if many}
      <p>
        This removes them, with their settings and contacts. To get them back
        you need each one's recovery phrase.
      </p>
    {:else}
      <p>
        This removes it, with its settings and contacts. To get it back you need
        its recovery phrase.
      </p>
    {/if}
    <div class="actions">
      <AppAnchorButton
        className="actions__action"
        href="/setup"
        text="Back"
        variant="primary"
      />
      <Button
        className="actions__action"
        text={flow === "create" ? "Remove and create" : "Remove and restore"}
        variant="tertiary"
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
