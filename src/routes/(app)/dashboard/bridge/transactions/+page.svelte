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
  <Tabs bind:selectedTab={selectedView} items={views} on:change={changeView} />
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
</style>
