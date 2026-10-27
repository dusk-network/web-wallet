<svelte:options immutable={true} />

<script>
  import { onDestroy, onMount } from "svelte";
  import {
    getBalance,
    switchChain,
    watchBlocks,
    watchChainId,
  } from "@wagmi/core";
  import { account, duskEvm, wagmiConfig } from "$lib/web3/walletConnection";
  import { Bridge } from "$lib/components";
  import {
    gasPriceStore,
    gasStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import { getGasLimits, getGasSettings } from "$lib/contracts";

  /**
   * @typedef { import("@wagmi/core").GetBalanceReturnType } GetBalanceReturnType
   */
  /** @type {GetBalanceReturnType | undefined}  */
  let evmDuskBalance;

  /**
   * @param {number} id
   */
  async function switchChainHandler(id) {
    await switchChain(wagmiConfig, { chainId: id });
  }

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
                // eslint-disable-next-line no-console
                console.error("getBalance failed", e);
                evmDuskBalance = undefined;
              }
            }
          },
        })
      : () => {};
  }

  onMount(() => {
    if ($account.isConnected && $account.chainId !== duskEvm.id) {
      switchChainHandler(duskEvm.id);
    }

    const unwatchChain = watchChainId(wagmiConfig, {
      async onChange() {
        await switchChainHandler(duskEvm.id);
      },
    });

    return () => {
      unwatchChain();
    };
  });

  onDestroy(() => {
    unwatchBalance();
  });

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
  $: unshieldedAddress = currentProfile
    ? currentProfile.account.toString()
    : "";
  $: unshieldedAccount = currentProfile ? currentProfile.account : null;
</script>

<Bridge
  {unshieldedAddress}
  {unshieldedAccount}
  {evmDuskBalance}
  unshieldedBalance={balance.unshielded.value}
  {gasLimits}
  {gasSettings}
  on:operationChange
/>
