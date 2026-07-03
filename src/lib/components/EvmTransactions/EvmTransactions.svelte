<svelte:options immutable={true} />

<script>
  import { mdiArrowLeft, mdiContain } from "@mdi/js";
  import { fade } from "svelte/transition";

  import { AppAnchorButton } from "$lib/components";
  import { Icon } from "$lib/dusk/components";
</script>

<article in:fade|global class="transactions">
  <header class="transactions__header">
    <h3 class="h4">Bridge Transactions</h3>
    <AppAnchorButton
      className="transactions__footer-button"
      href="/dashboard/bridge"
      text="Back"
      variant="tertiary"
      icon={{ path: mdiArrowLeft }}
    />
  </header>

  <div class="transactions-list__empty">
    <Icon path={mdiContain} size="large" />
    <p>
      Bridge withdrawal finalization is handled through the DuskEVM withdrawal
      flow.
    </p>
  </div>
</article>

<style lang="postcss">
  .transactions {
    border-radius: 1.25em;
    background: var(--surface-color);
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    padding-top: 1.375em;

    &__header {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: 0 1rem;
      gap: 0.625rem;
      flex-wrap: wrap;

      & :global(h3) {
        line-height: 150%;
      }
    }
  }

  :global {
    .transactions-list__empty {
      padding: 3rem 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      text-align: center;
      color: var(--secondary-text-color);
    }
  }
</style>
