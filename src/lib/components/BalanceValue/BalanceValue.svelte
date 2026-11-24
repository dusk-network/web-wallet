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

  /**
   * The value in full, shown on hover where `value` shortens it.
   *
   * @type {string | undefined}
   */
  export let exact = undefined;

  /**
   * Whether it's hidden, where that isn't simply while balances are: false
   * inside a flow the person started, which shows its figures.
   *
   * @type {boolean | undefined}
   */
  export let hidden = undefined;

  $: ({ hideBalances } = $settingsStore);
</script>

{#if hidden ?? hideBalances}
  <span aria-hidden="true">{BALANCE_MASK}</span>
  <span class="sr-only">hidden</span>
{:else if exact && exact !== value}
  <span title={exact}>{value}</span>
{:else}
  {value}
{/if}
