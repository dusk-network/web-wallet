<svelte:options immutable={true} />

<script>
  import { onDestroy } from "svelte";
  import {
    getBalance,
    switchChain,
    watchBlocks,
    watchChainId,
  } from "@wagmi/core";
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

  /** Stops keeping the wallet on its chain. */
  let unwatchChain = () => {};

  /** The chain a wallet is kept on, or none. */
  /** @type {number | undefined} */
  let keptOn;

  /**
   * Keeps a connected wallet on the chain the route picked uses (DuskEVM's,
   * or a migration's), moving it back when it changes chain: none to keep,
   * nor a connection to ask, while none is connected or the route needs no
   * chain.
   *
   * @param {boolean} connected
   * @param {number | undefined} chainId
   */
  function keepOnChain(connected, chainId) {
    const target = connected ? chainId : undefined;

    if (target === keptOn) {
      return;
    }

    keptOn = target;
    unwatchChain();
    unwatchChain = () => {};

    if (target) {
      if ($account.chainId !== target) {
        switchChainHandler(target).catch(() => {});
      }

      unwatchChain = watchChainId(wagmiConfig, {
        async onChange() {
          await switchChainHandler(target).catch(() => {});
        },
      });
    }
  }

  /** The chain the route picked uses, as the card says. */
  /** @type {number | undefined} */
  let evmChainId;

  onDestroy(() => {
    unwatchChain();
    unwatchBalance();
  });

  $: keepOnChain($account.isConnected, evmChainId);

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
