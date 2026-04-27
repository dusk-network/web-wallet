<svelte:options immutable={true} />

<script>
  import { Card, Icon } from "$lib/dusk/components";
  import { AppAnchor } from "$lib/components";

  /** @type {DashboardNavItem[]} */
  export let items;
</script>

<Card className="dashboard-nav-card">
  <nav class="dashboard-nav" aria-label="Transaction and operations navigation">
    {#each items as item (item.id)}
      {@const { icons, label, href } = item}
      <AppAnchor
        {href}
        tabindex="0"
        className="dashboard-nav__item"
        role="menuitem"
      >
        <span class="dashboard-nav__item-label">{label}</span>
        {#if icons?.length}
          <span class="dashboard-nav__item-icons">
            {#each icons as icon (icon.path)}
              <Icon path={icon.path} />
            {/each}
          </span>
        {/if}
      </AppAnchor>
    {/each}
  </nav>
</Card>

<style lang="postcss">
  .dashboard-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;

    :global(&__item) {
      display: flex;
      flex-direction: row-reverse;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      min-height: 3.5rem;
      padding: 0.75rem 0.5rem;
      border-right: 1px solid var(--surface-border-color-subtle);
      border-bottom: 1px solid var(--surface-border-color-subtle);
      color: var(--on-surface-color) !important;
      text-align: center;

      &:nth-child(2n) {
        border-right: none;
      }

      &:nth-last-child(-n + 2) {
        border-bottom: none;
      }

      &:hover {
        background-color: var(--surface-hover-color);
        color: var(--secondary-color-variant-dark) !important;
        text-decoration: none !important;
      }
    }

    &__item-label {
      font-size: 0.95rem;
      font-style: normal;
      font-weight: 500;
      line-height: 1.1;
    }

    &__item-icons {
      display: flex;
      flex-direction: row;
      gap: 0.625rem;
      color: var(--secondary-color-variant-dark);
    }
  }

  :global(.dashboard-nav-card .dusk-card__body-container) {
    padding: 0;
  }

  :global(.dark .dashboard-nav__item-icons),
  :global(.dark .dashboard-nav__item:hover) {
    color: var(--secondary-color) !important;
  }
</style>
