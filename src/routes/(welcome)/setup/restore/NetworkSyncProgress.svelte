<svelte:options immutable={true} />

<script>
  import { mdiCubeOutline } from "@mdi/js";

  import { Button, ErrorAlert } from "$lib/dusk/components";
  import { logout } from "$lib/navigation";

  import { SyncBar } from "$lib/components";
  import IconHeadingCard from "$lib/containers/Cards/IconHeadingCard.svelte";

  import { walletStore } from "$lib/stores";

  $: ({ syncStatus } = $walletStore);

  /** @type {boolean} */
  export let isValid = false;

  /** @type {bigint} */
  export let fromBlock = 0n;

  let syncStarted = false;
  $: if (!syncStarted && syncStatus.isInProgress) {
    syncStarted = true;
  }

  $: isValid = syncStarted && !syncStatus.isInProgress && !syncStatus.error;
</script>

<IconHeadingCard icons={[mdiCubeOutline]} heading="Network Sync">
  {#if syncStatus.error && !syncStatus.isInProgress}
    <ErrorAlert error={syncStatus.error} summary="Sync failed" />
    <Button
      text="Retry synchronization"
      on:click={() => walletStore.sync(fromBlock)}
    />
    <Button
      text="Lock wallet and exit"
      variant="tertiary"
      on:click={() => logout(false)}
    />
  {:else if !syncStarted || (syncStatus.isInProgress && !syncStatus.progress)}
    <span>Syncing...</span>
  {:else if syncStatus.isInProgress}
    <span>Syncing... <b>{(syncStatus.progress * 100).toFixed(0)}%</b></span>
    <SyncBar
      from={syncStatus.from}
      last={syncStatus.last}
      progress={syncStatus.progress}
    />
  {:else}
    <span>Sync completed!</span>
  {/if}
</IconHeadingCard>
