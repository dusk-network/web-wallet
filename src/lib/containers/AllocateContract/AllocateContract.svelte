<svelte:options immutable={true} />

<script>
  import {
    gasPriceStore,
    gasStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { getGasLimits, getGasSettings } from "$lib/contracts";
  import { Allocate } from "$lib/components";

  const gasLimits = getGasLimits("allocate", $gasStore);

  $: ({ customGasLimit, customGasPrice } = $settingsStore);
  $: gasSettings = getGasSettings(
    "allocate",
    { customGasLimit, customGasPrice },
    $gasPriceStore
  );
  $: ({ balance, currentProfile } = $walletStore);
  $: shieldedAddress = currentProfile ? currentProfile.address.toString() : "";
  $: unshieldedAddress = currentProfile
    ? currentProfile.account.toString()
    : "";
</script>

<Allocate
  {shieldedAddress}
  {unshieldedAddress}
  shieldedBalance={balance.shielded}
  unshieldedBalance={balance.unshielded.value}
  {gasLimits}
  {gasSettings}
  on:operationChange
/>
