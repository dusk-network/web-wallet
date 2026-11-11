<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import {
    arrivalTitle,
    followNotificationClicks,
  } from "$lib/bridge/arrivalNotice";
  import { tabTitle } from "$lib/containers/Shell/navigation";
  import { settingsStore } from "$lib/stores";
  import { goto, logout, peekPlace } from "$lib/navigation";
  import { Toast, Tooltip } from "$lib/dusk/components";

  import "../style/main.css";

  settingsStore.subscribe(({ darkMode }) => {
    document.documentElement.classList.toggle("dark", darkMode);
  });

  let invalidating = false;

  // A notification pressed opens what it says arrived, from any page: where
  // the wallet locked since, the unlock goes on to it.
  onMount(() => followNotificationClicks((href) => goto(href)));

  // Each page's own title: a payment request's page is the request's.
  $: title = tabTitle($page.url.pathname, peekPlace());

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
  <title>{$arrivalTitle ? `${$arrivalTitle} · ` : ""}{title}</title>
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
