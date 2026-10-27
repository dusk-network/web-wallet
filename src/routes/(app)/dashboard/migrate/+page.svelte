<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import { WalletConnectionGate } from "$lib/components";
  import { MigrateContract } from "$lib/containers";
  import { networkStore, operationsStore } from "$lib/stores";

  /** @param {string} id */
  function updateOperation(id) {
    operationsStore.update((store) => ({
      ...store,
      currentOperation: id,
    }));
  }

  onDestroy(() => {
    updateOperation("");
  });

  const { networkName } = $networkStore;
</script>

{#if ["mainnet", "testnet"].includes(networkName)}
  <WalletConnectionGate>
    <MigrateContract migrationNetwork={networkName} />
  </WalletConnectionGate>
{/if}
