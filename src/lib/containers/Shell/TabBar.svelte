<svelte:options immutable={true} />

<script>
  import { Icon } from "$lib/dusk/components";
  import { addBasePath } from "$lib/navigation";

  /** @type {import("./navigation").ShellTab[]} */
  export let tabs;

  /** @type {string | null} */
  export let activeTab;
</script>

<!-- The phone's pages, at the bottom of the screen. -->
<nav aria-label="Wallet pages" class="tab-bar">
  {#each tabs as tab (tab.id)}
    <a
      aria-current={tab.id === activeTab ? "page" : undefined}
      class="tab-bar__tab"
      class:tab-bar__tab--on={tab.id === activeTab}
      href={addBasePath(tab.href)}
    >
      <Icon path={tab.icon} />
      <span>{tab.label}</span>
    </a>
  {/each}
</nav>

<style lang="postcss">
  .tab-bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    height: calc(var(--tab-bar-height) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid var(--calm-line);
    background: var(--calm-panel);
  }

  .tab-bar__tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-height: 44px;
    color: var(--calm-subtle);
    font-size: 0.75rem;
    text-decoration: none;

    & :global(.dusk-icon) {
      width: 1.375rem;
      height: 1.375rem;
    }

    &--on {
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: -4px;
      border-radius: 0.75rem;
    }
  }
</style>
