<svelte:options immutable={true} />

<script>
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/stores";

  import { updateOperation } from "$lib/contracts";
  import { BridgeContract } from "$lib/containers";
  import { gasPriceStore } from "$lib/stores";

  onDestroy(() => {
    updateOperation("");
  });

  // The gas price as the network asks it now: read again while a form
  // shows, so its Review opens with it.
  onMount(() => gasPriceStore.keepFresh());

  // A link can open the card on a route: `?route=bsc-to-dusk`.
  $: ({ url } = $page);
</script>

{#if import.meta.env.VITE_FEATURE_BRIDGE === "true" || import.meta.env.VITE_FEATURE_MIGRATE === "true"}
  <BridgeContract
    linkedRoute={url.searchParams.get("route")}
    on:operationChange={({ detail }) => updateOperation(detail)}
  />
{/if}
