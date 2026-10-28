<script>
  import { page } from "$app/stores";
  import { pageName } from "$lib/containers/Shell/navigation";
  import { settingsStore } from "$lib/stores";
  import { logout } from "$lib/navigation";
  import { Toast, Tooltip } from "$lib/dusk/components";

  import "../style/main.css";

  settingsStore.subscribe(({ darkMode }) => {
    document.documentElement.classList.toggle("dark", darkMode);
  });

  let invalidating = false;

  // Each page's own name, for its title and the screen reader's
  // announcement of it.
  $: name = pageName($page.url.pathname);

  // The wallet's pages have their top bar and navigation around their main
  // content (Shell); the others are one main content, with its heading.
  $: inShell = $page.route.id?.startsWith("/(app)") ?? false;

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
  <title>{name ? `${name} · Dusk Wallet` : "Dusk Wallet"}</title>
</svelte:head>

<svelte:element this={inShell ? "div" : "main"} class="app">
  {#if !inShell}
    <h1 class="sr-only">{name || "Dusk Wallet"}</h1>
  {/if}
  <slot />
</svelte:element>

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
