<svelte:options immutable={true} />

<script>
  import { onDestroy, onMount } from "svelte";
  import { AllocateContract } from "$lib/containers";
  import { updateOperation } from "$lib/contracts";
  import { PageCard } from "$lib/containers/Cards";
  import { gasPriceStore } from "$lib/stores";

  onDestroy(() => {
    updateOperation("");
  });

  // The gas price as the network asks it now: read again while the form
  // shows, so its Review opens with it.
  onMount(() => gasPriceStore.keepFresh());
</script>

{#if import.meta.env.VITE_FEATURE_ALLOCATE || false}
  <PageCard heading="Shield">
    <AllocateContract
      on:operationChange={({ detail }) => updateOperation(detail)}
    />
  </PageCard>
{/if}
