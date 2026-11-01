<script>
  import { onDestroy, onMount } from "svelte";

  import {
    INACTIVITY_TIMEOUT,
    logout,
    startInactivityTimer,
  } from "$lib/navigation";
  import { followRouteHistory } from "$lib/bridge/routeHistory";
  import { Shell } from "$lib/containers/Shell";
  import { gasPriceStore, settingsStore, walletStore } from "$lib/stores";
  import vault from "$lib/vault";
  import { followOtherTabs, noteOpenWallet } from "$lib/wallets";

  // A wallet with a password locks after the time set in Settings, or not at
  // all. One without a password always locks after fifteen minutes: opening
  // it again takes the recovery phrase, so there is nothing to set.
  const hasPassword = vault.exists();

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

  // A migration's payout reaches the history while the wallet is open.
  onMount(() => followRouteHistory());

  // Another tab's switch, removal, new password or lock reaches this one.
  onMount(() => followOtherTabs());

  onDestroy(() => stopInactivityTimer());

  $: autoLockTimeout = hasPassword
    ? $settingsStore.autoLockMinutes * 60_000
    : INACTIVITY_TIMEOUT;

  // Only a new time restarts the timer.
  $: restartInactivityTimer(autoLockTimeout);

  $: ({ initialized, walletKey } = $walletStore);

  // The wallet open, the one the next unlock opens.
  $: openWallet = initialized ? walletKey : "";
  $: if (openWallet) {
    noteOpenWallet().catch(() => {});
  }
</script>

<Shell>
  <!-- Each page is drawn for the wallet open: another wallet draws it
    again, and what the one before showed acts no more. -->
  {#key walletKey}
    <slot />
  {/key}
</Shell>
