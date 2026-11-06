<script>
  import { onDestroy, onMount } from "svelte";

  import {
    INACTIVITY_TIMEOUT,
    keepProfile,
    logout,
    startInactivityTimer,
  } from "$lib/navigation";
  import { followArrivals } from "$lib/bridge/arrivalFollowing";
  import { followRouteHistory } from "$lib/bridge/routeHistory";
  import { Shell } from "$lib/containers/Shell";
  import { SendPasswordDialog } from "$lib/containers/Wallets";
  import {
    cancelSendPassword,
    sendPasswordAsk,
  } from "$lib/security/sendPassword";
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

  // What ends is said to whoever isn't looking.
  onMount(() => followArrivals());

  // Another tab's switch, removal, new password or lock reaches this one.
  onMount(() => followOtherTabs());

  /** The browser is online again: the wallet syncs at once, not at its next turn. */
  function handleOnline() {
    void walletStore.refreshBalance();
  }

  onDestroy(() => stopInactivityTimer());

  // Nothing goes on asking for the password once the wallet's pages are gone.
  onDestroy(() => cancelSendPassword());

  $: autoLockTimeout = hasPassword
    ? $settingsStore.autoLockMinutes * 60_000
    : INACTIVITY_TIMEOUT;

  // Only a new time restarts the timer.
  $: restartInactivityTimer(autoLockTimeout);

  $: ({ currentProfile, initialized, profiles, walletKey } = $walletStore);

  // The profile a reload or a lock comes back to.
  $: if (initialized && currentProfile) {
    keepProfile(walletKey, profiles.indexOf(currentProfile));
  }

  // The wallet open, the one the next unlock opens.
  $: openWallet = initialized ? walletKey : "";
  $: if (openWallet) {
    noteOpenWallet().catch(() => {});
  }
</script>

<svelte:window on:online={handleOnline} />

<Shell>
  <!-- Each page is drawn for the wallet open: another wallet draws it
    again, and what the one before showed acts no more. -->
  {#key walletKey}
    <slot />
  {/key}
</Shell>

{#if $sendPasswordAsk}
  <!-- A dialog per ask: what's typed for one doesn't stay for the next. -->
  {#key $sendPasswordAsk}
    <SendPasswordDialog ask={$sendPasswordAsk} />
  {/key}
{/if}
