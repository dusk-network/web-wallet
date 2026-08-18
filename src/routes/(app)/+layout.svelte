<script>
  import { onMount } from "svelte";

  import { logout, startInactivityTimer } from "$lib/navigation";

  onMount(() => startInactivityTimer(() => logout(false)));

  /** @param {StorageEvent} event */
  function handleStorageChange(event) {
    const { key, newValue, oldValue } = event;

    if (key !== `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`) {
      return;
    }

    const oldId = oldValue ? JSON.parse(oldValue).userId : "";
    const newId = newValue ? JSON.parse(newValue).userId : "";

    if (oldId !== newId) {
      window.removeEventListener("storage", handleStorageChange);
      logout(true);
    }
  }
</script>

<svelte:window on:storage={handleStorageChange} />

<slot />
