<script>
  import { page } from "$app/stores";
  import { arrivalTitle } from "$lib/bridge/arrivalNotice";
  import { pageName } from "$lib/containers/Shell/navigation";
  import { settingsStore } from "$lib/stores";
  import { logout } from "$lib/navigation";
  import { Toast, Tooltip } from "$lib/dusk/components";

  import "../style/main.css";

  settingsStore.subscribe(({ darkMode }) => {
    document.documentElement.classList.toggle("dark", darkMode);
  });

  let invalidating = false;

  // Each page's own name, for its title.
  $: name = pageName($page.url.pathname);

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

    if (changed && !invalidating) {
      invalidating = true;
      // Reload after cancellation to discard cached login info and preferences
      // on welcome routes as well as authenticated routes.
      const reload = () => location.reload();
      logout(true).then(reload, reload);
    }
  }
</script>

<svelte:window on:storage={handleStorageChange} />

<svelte:head>
  <title
    >{$arrivalTitle ? `${$arrivalTitle} · ` : ""}{name
      ? `${name} · Dusk Wallet`
      : "Dusk Wallet"}</title
  >
</svelte:head>

<!-- The same element around every page: one that changed with the route would
  draw the page it brings again, from the unlock into the wallet. Each shell
  gives its page its main content, with its heading. -->
<div class="app">
  <slot />
</div>

<Tooltip id="main-tooltip" />
<Toast />

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
</style>
