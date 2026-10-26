<script>
  import { onDestroy, onMount } from "svelte";

  import {
    INACTIVITY_TIMEOUT,
    logout,
    startInactivityTimer,
  } from "$lib/navigation";
  import loginInfoStorage from "$lib/services/loginInfoStorage";
  import { gasPriceStore, settingsStore } from "$lib/stores";

  // A wallet with a password locks after the time set in Settings, or not at
  // all. One without a password always locks after fifteen minutes: opening
  // it again takes the recovery phrase, so there is nothing to set.
  const hasPassword = loginInfoStorage.get() !== null;

  /** @type {() => void} */
  let stopInactivityTimer = () => {};

  /** @param {number} timeout */
  function restartInactivityTimer(timeout) {
    stopInactivityTimer();
    stopInactivityTimer = timeout
      ? startInactivityTimer(() => logout(false), timeout)
      : () => {};
  }

  onMount(() => gasPriceStore.startRefreshing());

  onDestroy(() => stopInactivityTimer());

  $: autoLockTimeout = hasPassword
    ? $settingsStore.autoLockMinutes * 60_000
    : INACTIVITY_TIMEOUT;

  // Only a new time restarts the timer.
  $: restartInactivityTimer(autoLockTimeout);
</script>

<slot />
