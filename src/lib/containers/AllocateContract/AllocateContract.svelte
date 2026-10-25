<svelte:options immutable={true} />

<script>
  import { createCurrencyFormatter } from "$lib/dusk/currency";
  import { gasStore, settingsStore, walletStore } from "$lib/stores";
  import { getGasLimits, getGasSettings } from "$lib/contracts";
  import { Allocate } from "$lib/components";

  const gasLimits = getGasLimits("allocate", $gasStore);

  $: ({ customGasLimit, gasPrice, language } = $settingsStore);
  $: gasSettings = getGasSettings("allocate", { customGasLimit, gasPrice });
  $: ({ balance, currentProfile } = $walletStore);
  $: shieldedAddress = currentProfile ? currentProfile.address.toString() : "";
  $: unshieldedAddress = currentProfile
    ? currentProfile.account.toString()
    : "";
  $: duskFormatter = createCurrencyFormatter(language, "DUSK", 9);
</script>

<Allocate
  {shieldedAddress}
  {unshieldedAddress}
  shieldedBalance={balance.shielded}
  unshieldedBalance={balance.unshielded.value}
  formatter={duskFormatter}
  {gasLimits}
  {gasSettings}
  on:operationChange
/>
