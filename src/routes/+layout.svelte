<script>
  import { settingsStore } from "$lib/stores";
  import { logout } from "$lib/navigation";
  import { Toast, Tooltip } from "$lib/dusk/components";

  import "../style/main.css";

  settingsStore.subscribe(({ darkMode }) => {
    document.documentElement.classList.toggle("dark", darkMode);
  });

  /** @param {StorageEvent} event */
  function handleStorageChange({ key, oldValue, newValue, storageArea }) {
    if (
      storageArea !== localStorage ||
      (key !== null && key !== `${CONFIG.LOCAL_STORAGE_APP_KEY}-preferences`)
    ) {
      return;
    }

    let changed = key === null;
    try {
      changed ||=
        (oldValue ? JSON.parse(oldValue)?.userId : "") !==
        (newValue ? JSON.parse(newValue)?.userId : "");
    } catch {
      changed = true;
    }

    if (changed) {
      // Reload after cancellation to discard cached login info and preferences
      // on welcome routes as well as authenticated routes.
      const reload = () => location.reload();
      logout(true).then(reload, reload);
    }
  }
</script>

<svelte:window on:storage={handleStorageChange} />

<main class="app">
  <h1 class="sr-only">Dusk Web Wallet</h1>
  <slot />
</main>

<Tooltip id="main-tooltip" />
<Toast />

<style>
  .app {
    height: 100%;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    overflow-y: hidden;
  }
</style>
