<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";
  import {
    getBalance,
    switchChain,
    watchBlocks,
    watchChainId,
  } from "@wagmi/core";
  import { mdiListStatus } from "@mdi/js";

  import { Button } from "$lib/dusk/components";
  import {
    account,
    duskEvm,
    modal,
    wagmiConfig,
  } from "$lib/web3/walletConnection";
  import { AppAnchorButton, Bridge } from "$lib/components";
  import { createCurrencyFormatter } from "$lib/dusk/currency";
  import { gasStore, settingsStore, walletStore } from "$lib/stores";

  /**
   * @param {SettingsStoreContent} settings
   * @returns {[ContractGasSettings, string]}
   */
  const collectSettings = ({ gasLimit, gasPrice, language }) => [
    { gasLimit, gasPrice },
    language,
  ];

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

  onMount(() => {
    if ($account.isConnected && $account.chainId !== duskEvm.id) {
      switchChainHandler(duskEvm.id);
    }

    const unwatchChain = watchChainId(wagmiConfig, {
      async onChange() {
        await switchChainHandler(duskEvm.id);
      },
    });
    const unwatchBalance = watchBlocks(wagmiConfig, {
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
    });

    return () => {
      unwatchChain();
      unwatchBalance();
    };
  });

  $: ({ isConnected } = $account);
  $: ({ balance, currentProfile } = $walletStore);
  $: [gasSettings, language] = collectSettings($settingsStore);
  $: gasLimits = $gasStore;
  $: unshieldedAddress = currentProfile
    ? currentProfile.account.toString()
    : "";
  $: unshieldedAccount = currentProfile ? currentProfile.account : null;
  $: formatter = createCurrencyFormatter(language, "DUSK", 9);
</script>

{#if !isConnected}
  <article class="bridge-wallet">
    <header class="bridge-wallet__header">
      <h3 class="h4">Bridge</h3>
      <AppAnchorButton
        href="/dashboard/bridge/transactions"
        text="Activity"
        variant="tertiary"
        icon={{ path: mdiListStatus }}
      />
    </header>
    <div class="bridge-wallet__connect">
      <Button text="CONNECT WEB3 WALLET" on:click={() => modal.open()} />
    </div>
  </article>
{:else}
  <Bridge
    {unshieldedAddress}
    {unshieldedAccount}
    {evmDuskBalance}
    unshieldedBalance={balance.unshielded.value}
    {formatter}
    {gasLimits}
    {gasSettings}
    on:operationChange
  />
{/if}

<style lang="postcss">
  .bridge-wallet {
    background: var(--surface-color);
    border-radius: 1.25em;
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    padding: 1.25em;

    &__header {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: space-between;
    }

    &__connect {
      align-items: center;
      border: 1px solid var(--surface-border-color);
      border-radius: var(--fieldset-border-radius);
      display: flex;
      justify-content: center;
      min-height: 10rem;
      padding: 1rem;
    }
  }
</style>
