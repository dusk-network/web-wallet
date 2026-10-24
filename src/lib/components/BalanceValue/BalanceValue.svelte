<svelte:options immutable={true} />

<script>
  import { BALANCE_MASK } from "$lib/constants";
  import { settingsStore } from "$lib/stores";

  /**
   * Some of what the user holds, formatted. While balances are hidden,
   * it shows as dots, and screen readers read "hidden".
   *
   * @type {string}
   */
  export let value;

  $: ({ hideBalances } = $settingsStore);
</script>

{#if hideBalances}
  <span aria-hidden="true">{BALANCE_MASK}</span>
  <span class="sr-only">hidden</span>
{:else}
  {value}
{/if}
