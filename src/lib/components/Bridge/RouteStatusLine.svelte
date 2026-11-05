<svelte:options immutable={true} />

<script>
  /**
   * How a route is doing, in a line under it: read as the card opens on it, and
   * only ever said.
   */
  import {
    openRouteStatus,
    routeStatuses,
    statusLine,
  } from "$lib/bridge/routeStatus";
  import { settingsStore } from "$lib/stores";

  /** @type {{ id: string, running?: boolean }} */
  export let route;

  /** What's being sent, in Lux. */
  /** @type {bigint | null} */
  export let amountLux = null;

  $: openRouteStatus(route);
  $: line = route.running
    ? statusLine($routeStatuses.get(route.id), {
        amountLux: amountLux || null,
        locale: $settingsStore.language,
      })
    : null;
</script>

{#if line}
  <span class="swap-route__status" class:swap-route__status--warn={line.warn}
    >{line.text}</span
  >
{/if}
