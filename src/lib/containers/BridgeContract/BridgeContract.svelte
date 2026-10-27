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
   * @param {boolean} isConnected
   */
  function watchBalance(isConnected) {
    unwatchBalance();
    unwatchBalance = isConnected
      ? watchBlocks(wagmiConfig, {
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

  $: isConnected = Boolean($account.isConnected);
  $: watchBalance(isConnected);
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
