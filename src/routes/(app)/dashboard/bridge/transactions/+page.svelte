<svelte:options immutable={true} />

<script>
  import { EvmTransactions } from "$lib/components";
</script>

<!-- Deposits and withdrawals in one list, as the Dusk Bridge lists them. -->
<EvmTransactions />
