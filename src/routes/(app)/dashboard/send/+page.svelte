<svelte:options immutable={true} />

<script>
  import { feeToKeep } from "$lib/wallet-reserve";
  import { page } from "$app/stores";
  import { activityState } from "$lib/activity";
  import { Send } from "$lib/components";
  import { executeSend, getGasLimits, getGasSettings } from "$lib/contracts";
  import { resolveDuskName } from "$lib/dusk-domains";
  import {
    REQUEST_FIELDS,
    ownWalletUrl,
    readPaymentLink,
  } from "$lib/payment-requests";
  import {
    gasPriceStore,
    gasStore,
    networkStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import { nodeBaseUrl } from "$lib/url";
  import { profileLabel } from "$lib/wallet";
  import { openProfileNames } from "$lib/wallets";

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

  // What this page sends, it sends from the wallet it was drawn for.
  const send = walletStore.forThisWallet()(executeSend);

  const { networkName } = $networkStore;

  /**
   * What the page's address asks of its form: a recipient, as from Send again
   * or a contact, or a link's amount and memo with it, or why a link fills in
   * nothing. It's read as any link is, whichever address it's opened at.
   *
   * @param {URL} at
   * @param {import("@dusk-network/networks").Network | null} net
   * @param {string} language
   */
  const askedBy = (at, net, language) =>
    REQUEST_FIELDS.some((field) => at.searchParams.has(field))
      ? readPaymentLink(
          `${ownWalletUrl()}/dashboard/send${at.search}`,
          net,
          language
        )
      : null;

  // The form starts again with another request, as from the search while it
  // shows.
  $: ({ url } = $page);
  $: asked = askedBy(url, $nodeNetwork, $settingsStore.language);
  $: askedKey = JSON.stringify(asked);

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
  $: ({ balance, balanceRead, currentProfile } = $walletStore);
  $: spendable =
    spendableSource === "shielded"
      ? balance.shielded.spendable
      : balance.unshielded.value;
  $: shieldedAddress = currentProfile ? currentProfile.address.toString() : "";
  $: publicAddress = currentProfile ? currentProfile.account.toString() : "";
  $: knownNames = pastNames($activityState.rows);
  $: ownAccounts = $walletStore.profiles.flatMap((profile) => {
    const label = profileLabel(
      $walletStore.profiles,
      profile,
      networkName,
      $openProfileNames
    );

    return [
      { address: String(profile.account), label },
      { address: String(profile.address), label: `${label}, shielded` },
    ];
  });
</script>

{#key askedKey}
  <Send
    availableBalance={spendable}
    balanceKnown={balanceRead !== false}
    bep20BridgeAddress={BEP20_BRIDGE_ADDRESS}
    execute={send}
    {gasLimits}
    {gasSettings}
    historyRows={$activityState.rows}
    initialAmount={asked?.amount ?? ""}
    initialAmountHidden={Boolean($page.state?.amountHidden)}
    initialElsewhere={asked?.elsewhere ?? null}
    initialMemo={asked?.memo ?? ""}
    initialProblem={asked?.problem ?? ""}
    initialRecipient={asked?.to ?? ""}
    keepForLater={$feeToKeep}
    {knownNames}
    on:keyChange={keyChangeHandler}
    {ownAccounts}
    {publicAddress}
    {resolveName}
    shieldedBalance={balance.shielded.spendable}
    {shieldedAddress}
  />
{/key}
