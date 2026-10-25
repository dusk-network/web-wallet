<svelte:options immutable={true} />

<script>
  import { mdiArrowTopRight } from "@mdi/js";
  import { ContractStatusesList, Send } from "$lib/components";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { executeSend } from "$lib/contracts";
  import { createCurrencyFormatter, luxToDusk } from "$lib/dusk/currency";
  import { resolveDuskName } from "$lib/dusk-domains";
  import {
    gasStore,
    networkStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { makeNodeUrl } from "$lib/url";

  /** @type {(source: "shielded" | "unshielded", balanceInfo: WalletStoreBalance) => [bigint, ContractStatus[]]}*/
  function getContractInfo(source, balanceInfo) {
    const spendable =
      source === "shielded"
        ? balanceInfo.shielded.spendable
        : balanceInfo.unshielded.value;
    const statuses = [
      {
        label: `Spendable (${source === "shielded" ? "shielded" : "public"})`,
        value: duskFormatter(luxToDusk(spendable)),
      },
    ];

    return [spendable, statuses];
  }

  /**
   * @param {SettingsStoreContent} settings
   * @returns {[ContractGasSettings, string]}
   */
  const collectSettings = ({ gasLimit, gasPrice, language }) => [
    { gasLimit, gasPrice },
    language,
  ];
  const gasLimits = $gasStore;

  /** @type {"shielded" | "unshielded"} */
  let spendableSource = "unshielded";

  /**
   * Shows the shielded balance for a transfer to a shielded address, and
   * the public one otherwise, also while there is no recipient.
   *
   * @param {CustomEvent<{ type: "account" | "address" | undefined}>} event
   */
  function keyChangeHandler(event) {
    if (event.detail.type === "address") {
      spendableSource = "shielded";
    } else {
      spendableSource = "unshielded";
    }
  }

  const BEP20_BRIDGE_ADDRESS = import.meta.env.VITE_BEP20_BRIDGE_ADDRESS;

  const { networkName } = $networkStore;

  /**
   * Names resolve through the wallet's own node: the origin of its
   * URL, which is where w3sper sends its requests.
   *
   * @param {string} name
   */
  const resolveName = (name) =>
    resolveDuskName(name, networkName, makeNodeUrl().origin);

  $: [gasSettings, language] = collectSettings($settingsStore);
  $: duskFormatter = createCurrencyFormatter(language, "DUSK", 9);
  $: ({ balance, currentProfile } = $walletStore);
  $: [spendable, statuses] = getContractInfo(spendableSource, balance);
  $: shieldedAddress = currentProfile ? currentProfile.address.toString() : "";
  $: publicAddress = currentProfile ? currentProfile.account.toString() : "";
</script>

<IconHeadingCard gap="large" heading="Send" icons={[mdiArrowTopRight]} reverse>
  <ContractStatusesList {statuses} />
  <Send
    {shieldedAddress}
    {publicAddress}
    execute={executeSend}
    formatter={duskFormatter}
    {resolveName}
    {gasLimits}
    {gasSettings}
    availableBalance={spendable}
    shieldedBalance={balance.shielded.spendable}
    bep20BridgeAddress={BEP20_BRIDGE_ADDRESS}
    on:keyChange={keyChangeHandler}
  />
</IconHeadingCard>
