<svelte:options immutable={true} />

<script>
  import { createCurrencyFormatter } from "$lib/dusk/currency";
  import { gasStore, settingsStore, walletStore } from "$lib/stores";
  import { Allocate } from "$lib/components";

  /**
   * @param {SettingsStoreContent} settings
   * @returns {[ContractGasSettings, string]}
   */
  const collectSettings = ({ gasLimit, gasPrice, language }) => [
    { gasLimit, gasPrice },
    language,
  ];
  const gasLimits = $gasStore;

  $: [gasSettings, language] = collectSettings($settingsStore);
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
