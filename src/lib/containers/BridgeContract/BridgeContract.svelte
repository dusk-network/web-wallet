<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import { getBalance, watchBlocks } from "@wagmi/core";
  import { askToSwitch } from "$lib/bridge/chainSwitch";
  import { account, duskEvm, wagmiConfig } from "$lib/web3/walletConnection";
  import { Bridge } from "$lib/components";
  import {
    gasPriceStore,
    gasStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { getGasLimits, getGasSettings } from "$lib/contracts";
  import { feeToKeep } from "$lib/wallet-reserve";

  /** The route a link names (`?route=bsc-to-dusk`), or none. */
  /** @type {string | null} */
  export let linkedRoute = null;

  /**
   * @typedef { import("@wagmi/core").GetBalanceReturnType } GetBalanceReturnType
   */
  /** @type {GetBalanceReturnType | undefined}  */
  let evmDuskBalance;

  /** Stops reading the balance on each block. */
  let unwatchBalance = () => {};

  /**
   * Reads the connected EVM wallet's balance on DuskEVM on each new block
   * there, only while one is connected: without one there is nothing to read,
   * and no block to ask for. It's DuskEVM's whichever chain the wallet is on,
   * as it may stay on another.
   *
   * The watch names its chain: without one, wagmi swaps in a new watch on a
   * chain change that stopping the first one leaves running.
   *
   * @param {boolean} isConnected
   */
  function watchBalance(isConnected) {
    unwatchBalance();
    unwatchBalance = isConnected
      ? watchBlocks(wagmiConfig, {
          chainId: duskEvm.id,
          async onBlock() {
            if ($account.isConnected && $account.address) {
              try {
                evmDuskBalance = await getBalance(wagmiConfig, {
                  address: $account.address,
                  chainId: duskEvm.id,
                });
              } catch (e) {
                console.error("getBalance failed", e);
                evmDuskBalance = undefined;
              }
            }
          },
        })
      : () => {};
  }

  /**
   * The chain the wallet was last asked to be on.
   *
   * @type {number | undefined}
   */
  let askedFor;

  /**
   * Asks the wallet to move to the chain the route picked uses (a withdrawal's
   * or a migration's), once, as the route opens or a wallet connects to it:
   * none while none is connected or the route needs no chain. It's not asked
   * back if it moves later: another tab may have moved it, and asking back
   * would have that tab ask too, without end. The card offers to switch, and a
   * withdrawal asks as it's sent.
   *
   * @param {boolean} connected
   * @param {number | undefined} now
   * @param {number | undefined} target
   */
  function keepOnChain(connected, now, target) {
    const wanted = connected ? target : undefined;

    if (wanted === askedFor) {
      return;
    }

    askedFor = wanted;

    if (wanted !== undefined && now !== wanted) {
      askToSwitch(wanted);
    }
  }

  /** The chain the route picked uses, as the card says. */
  /** @type {number | undefined} */
  let evmChainId;

  onDestroy(() => {
    unwatchBalance();
  });

  $: keepOnChain($account.isConnected, $account.chainId, evmChainId);

  $: isWalletConnected = $account.isConnected;
  $: watchBalance(isWalletConnected);
  $: ({ balance, currentProfile } = $walletStore);
  $: ({ customGasLimit, customGasPrice } = $settingsStore);
  $: gasSettings = getGasSettings(
    "bridge",
    { customGasLimit, customGasPrice },
    $gasPriceStore
  );
  $: gasLimits = getGasLimits("bridge", $gasStore);
  $: transferGasSettings = getGasSettings(
    "public-transfer",
    { customGasLimit, customGasPrice },
    $gasPriceStore
  );
  $: transferGasLimits = getGasLimits("public-transfer", $gasStore);
  $: unshieldedAddress = currentProfile
    ? currentProfile.account.toString()
    : "";
  $: unshieldedAccount = currentProfile ? currentProfile.account : null;
</script>

<Bridge
  bind:evmChainId
  {unshieldedAddress}
  {unshieldedAccount}
  {evmDuskBalance}
  keepForLater={$feeToKeep}
  unshieldedBalance={balance.unshielded.value}
  {gasLimits}
  {gasSettings}
  {linkedRoute}
  {transferGasLimits}
  {transferGasSettings}
  on:operationChange
/>
