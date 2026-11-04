<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import { getBalance, watchBlocks } from "@wagmi/core";
  import { askToSwitch, forgetChainRefusal } from "$lib/bridge/chainSwitch";
  import { account, wagmiConfig } from "$lib/web3/walletConnection";
  import { Bridge } from "$lib/components";
  import {
    gasPriceStore,
    gasStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { getGasLimits, getGasSettings } from "$lib/contracts";

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
   * Reads the connected EVM wallet's balance on each new block of its chain,
   * only while one is connected: without one there is nothing to read, and
   * no block to ask for.
   *
   * The watch names its chain and starts over when the wallet's chain
   * changes: without a chain, wagmi swaps in a new watch on a chain change
   * that stopping the first one leaves running.
   *
   * @param {number | undefined} chainId The connected wallet's chain, if
   *   one the page knows.
   */
  function watchBalance(chainId) {
    unwatchBalance();
    unwatchBalance = chainId
      ? watchBlocks(wagmiConfig, {
          chainId,
          async onBlock() {
            if ($account.isConnected && $account.chainId && $account.address) {
              try {
                evmDuskBalance = await getBalance(wagmiConfig, {
                  address: $account.address,
                  chainId: $account.chainId,
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

  /** Where the wallet was last asked to move from, and to. */
  let askedFor = "";

  /**
   * Keeps the wallet on the chain the route picked uses (a withdrawal's or a
   * migration's), asking once each time it's elsewhere, whether the page knows
   * that chain or not: none to keep while none is connected or the route needs
   * no chain.
   *
   * @param {boolean} connected
   * @param {number | undefined} now
   * @param {number | undefined} target
   */
  function keepOnChain(connected, now, target) {
    const elsewhere = connected && target !== undefined && now !== target;
    const key = elsewhere ? `${now}:${target}` : "";

    if (key === askedFor) {
      return;
    }

    askedFor = key;

    if (elsewhere) {
      askToSwitch(/** @type {number} */ (target));
    } else {
      forgetChainRefusal();
    }
  }

  /** The chain the route picked uses, as the card says. */
  /** @type {number | undefined} */
  let evmChainId;

  onDestroy(() => {
    unwatchBalance();
  });

  $: keepOnChain($account.isConnected, $account.chainId, evmChainId);

  $: balanceChainId = $account.isConnected ? $account.chain?.id : undefined;
  $: watchBalance(balanceChainId);
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
  unshieldedBalance={balance.unshielded.value}
  {gasLimits}
  {gasSettings}
  {linkedRoute}
  {transferGasLimits}
  {transferGasSettings}
  on:operationChange
/>
