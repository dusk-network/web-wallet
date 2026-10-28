<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { activityState } from "$lib/activity";
  import { Send } from "$lib/components";
  import { executeSend, getGasLimits, getGasSettings } from "$lib/contracts";
  import { resolveDuskName } from "$lib/dusk-domains";
  import {
    gasPriceStore,
    gasStore,
    networkStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { nodeBaseUrl } from "$lib/url";
  import { profileLabel } from "$lib/wallet";

  /** @type {"shielded" | "unshielded"} */
  let spendableSource = "unshielded";

  /**
   * Pays from the shielded balance for a transfer to a shielded address,
   * and from the public one otherwise, also while there is no recipient.
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

  /**
   * The `.dusk` names of past counterparties, newest first, for "Did you
   * mean …?".
   *
   * @param {ActivityRow[]} rows
   */
  const pastNames = (rows) => [
    ...new Set(
      rows.flatMap((row) =>
        [row.counterpartyName, row.toName].filter(
          /** @returns {name is string} */
          (name) => typeof name === "string" && name.endsWith(".dusk")
        )
      )
    ),
  ];

  const BEP20_BRIDGE_ADDRESS = import.meta.env.VITE_BEP20_BRIDGE_ADDRESS;

  const { networkName } = $networkStore;

  // The recipient the page opens with, as from Send again or a contact; the
  // form starts again with another one, as from the search while it shows.
  $: ({ url } = $page);
  $: initialRecipient = url.searchParams.get("to") ?? "";

  /**
   * Names resolve through the wallet's own node: the origin of its
   * URL, which is where w3sper sends its requests.
   *
   * @param {string} name
   */
  const resolveName = (name) =>
    resolveDuskName(name, networkName, nodeBaseUrl());

  /** @type {GasOperation} */
  $: transferOperation =
    spendableSource === "shielded" ? "shielded-transfer" : "public-transfer";
  $: ({ customGasLimit, customGasPrice } = $settingsStore);

  // `Send` takes new gas settings while its form shows: make new ones only
  // when the operation, the stored gas values or the node's price change.
  $: gasSettings = getGasSettings(
    transferOperation,
    { customGasLimit, customGasPrice },
    $gasPriceStore
  );
  $: gasLimits = getGasLimits(transferOperation, $gasStore);
  $: ({ balance, currentProfile } = $walletStore);
  $: spendable =
    spendableSource === "shielded"
      ? balance.shielded.spendable
      : balance.unshielded.value;
  $: shieldedAddress = currentProfile ? currentProfile.address.toString() : "";
  $: publicAddress = currentProfile ? currentProfile.account.toString() : "";
  $: knownNames = pastNames($activityState.rows);
  $: ownAccounts = $walletStore.profiles.flatMap((profile) => {
    const label = profileLabel($walletStore.profiles, profile, networkName);

    return [
      { address: String(profile.account), label },
      { address: String(profile.address), label: `${label}, shielded` },
    ];
  });
</script>

{#key initialRecipient}
  <Send
    availableBalance={spendable}
    bep20BridgeAddress={BEP20_BRIDGE_ADDRESS}
    execute={executeSend}
    {gasLimits}
    {gasSettings}
    {initialRecipient}
    {knownNames}
    on:keyChange={keyChangeHandler}
    {ownAccounts}
    {publicAddress}
    {resolveName}
    shieldedBalance={balance.shielded.spendable}
    {shieldedAddress}
  />
{/key}
