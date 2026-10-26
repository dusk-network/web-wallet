<svelte:options immutable={true} />

<script>
  import { Icon } from "$lib/dusk/components";
  import { addBasePath } from "$lib/navigation";

  /** @type {{ href: string, icon: string, id: string, label: string, primary?: boolean }[]} */
  export let actions;
</script>

<!-- Every action fits, on a phone too: round buttons in one row there. -->
<nav aria-label="Actions" class="home-actions">
  <ul class="home-actions__list">
    {#each actions as action (action.id)}
      <li>
        <a
          class="home-actions__action"
          class:home-actions__action--primary={action.primary}
          href={addBasePath(action.href)}
        >
          <span class="home-actions__icon"><Icon path={action.icon} /></span>
          <span class="home-actions__label">{action.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style lang="postcss">
  .home-actions__list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .home-actions__action {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 2.75rem;
    padding: 0 1.25rem;
    border-radius: 999px;
    background: var(--calm-s2);
    color: var(--calm-text);
    font-size: 0.90625rem;
    font-weight: 500;
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      background: var(--calm-s3);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }

    &--primary {
      background: var(--calm-pill);
      color: var(--calm-on-pill);

      &:hover {
        background: var(--calm-pill);
        opacity: 0.88;
      }
    }

    & :global(.dusk-icon) {
      width: 1.0625rem;
      height: 1.0625rem;
    }
  }

  @media (max-width: 47.99rem) {
    .home-actions__list {
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      gap: 0;
    }

    .home-actions__action,
    .home-actions__action--primary {
      flex-direction: column;
      gap: 0.5rem;
      width: 100%;
      height: auto;
      padding: 0;
      background: none;
      color: var(--calm-muted);
      font-size: 0.78125rem;
      font-weight: 400;

      &:hover {
        background: none;
        opacity: 1;
      }
    }

    .home-actions__icon {
      display: grid;
      place-items: center;
      width: 3.375rem;
      height: 3.375rem;
      border-radius: 50%;
      background: var(--calm-s2);
      color: var(--calm-text);

      & :global(.dusk-icon) {
        width: 1.375rem;
        height: 1.375rem;
      }
    }

    .home-actions__action--primary .home-actions__icon {
      background: var(--calm-pill);
      color: var(--calm-on-pill);
    }
  }
</style>
