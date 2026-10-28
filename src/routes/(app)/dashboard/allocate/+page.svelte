<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import { AllocateContract } from "$lib/containers";
  import { updateOperation } from "$lib/contracts";
  import { PageCard } from "$lib/containers/Cards";

  onDestroy(() => {
    updateOperation("");
  });
</script>

{#if import.meta.env.VITE_FEATURE_ALLOCATE || false}
  <PageCard heading="Shield">
    <AllocateContract
      on:operationChange={({ detail }) => updateOperation(detail)}
    />
  </PageCard>
{/if}
