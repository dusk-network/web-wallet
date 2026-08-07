<svelte:options immutable={true} />

<script>
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/stores";

  import { EvmTransactions } from "$lib/components";
  import DepositTransactions from "$lib/components/EvmTransactions/DepositTransactions.svelte";
  import { Tabs } from "$lib/dusk/components";

  const views = [
    { id: "deposits", label: "Deposits" },
    { id: "withdrawals", label: "Withdrawals" },
  ];

  let selectedView =
    $page.url.searchParams.get("view") === "deposits"
      ? "deposits"
      : "withdrawals";

  /** @param {CustomEvent<string>} event */
  function changeView(event) {
    const path = resolve("/(app)/dashboard/bridge/transactions");
    const href = `${path}?view=${event.detail}`;

    // The route is resolved above; the query string is intentionally appended afterwards.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(href, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  }
</script>

<div class="transactions">
  <h2 class="sr-only">Transactions</h2>
  <Tabs
    bind:selectedTab={selectedView}
    className="transactions__view-switcher"
    items={views}
    on:change={changeView}
  />
  {#if selectedView === "deposits"}
    <DepositTransactions />
  {:else}
    <EvmTransactions />
  {/if}
</div>

<style lang="postcss">
  .transactions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.375rem;
    flex: 1;
  }

  :global(.transactions__view-switcher) {
    background: var(--surface-soft-color);
    border: 1px solid var(--surface-border-color);
    border-radius: var(--control-border-radius-size);
    padding: 0.25rem;
  }

  :global(.transactions__view-switcher .dusk-tabs-list) {
    gap: 0.25rem;
  }

  :global(.transactions__view-switcher .dusk-tab-item) {
    border-radius: calc(var(--control-border-radius-size) - 0.125rem);
    color: var(--on-surface-color);
    flex: 1 0 0;
    font-size: 0.9375rem;
    font-weight: 500;
    min-height: 2.75rem;
    padding: 0.75rem 1rem;
  }

  :global(
    .transactions__view-switcher
      .dusk-tab-item:hover:not(.dusk-tab-item__selected)
  ),
  :global(.transactions__view-switcher .dusk-tab-item:focus-visible) {
    background: var(--surface-hover-color);
  }

  :global(.transactions__view-switcher .dusk-tab-item:hover > *),
  :global(.transactions__view-switcher .dusk-tab-item:focus-visible > *) {
    transform: none;
  }

  :global(.transactions__view-switcher .dusk-tab-item:focus-visible) {
    box-shadow: inset 0 0 0 2px var(--secondary-color);
  }

  :global(.transactions__view-switcher .dusk-tab-item__selected) {
    background: var(--control-bg-color);
    color: var(--control-text-color);
  }

  :global(
    .transactions__view-switcher .dusk-tab-item__selected > .dusk-tab-label
  ) {
    color: inherit;
  }
</style>
