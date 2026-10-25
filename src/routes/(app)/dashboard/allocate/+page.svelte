<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import { mdiArrowLeft, mdiSync } from "@mdi/js";
  import { AppAnchorButton, ShieldedPausedNotice } from "$lib/components";
  import { AllocateContract } from "$lib/containers";
  import { updateOperation } from "$lib/contracts";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { shieldedStatusStore } from "$lib/stores";

  onDestroy(() => {
    updateOperation("");
  });

  $: ({ isPaused: isShieldedPaused } = $shieldedStatusStore);
</script>

{#if import.meta.env.VITE_FEATURE_ALLOCATE || false}
  <IconHeadingCard heading="Allocate" icons={[mdiSync]}>
    {#if isShieldedPaused}
      <ShieldedPausedNotice />
      <AppAnchorButton
        href="/dashboard"
        icon={{ path: mdiArrowLeft }}
        text="Back"
        variant="tertiary"
      />
    {:else}
      <AllocateContract
        on:operationChange={({ detail }) => updateOperation(detail)}
      />
    {/if}
  </IconHeadingCard>
{/if}
