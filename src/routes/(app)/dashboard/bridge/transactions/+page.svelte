<svelte:options immutable={true} />

<script>
  import { EvmTransactions } from "$lib/components";
</script>

<div class="transactions">
  <h2 class="sr-only">Transactions</h2>
  <EvmTransactions />
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
