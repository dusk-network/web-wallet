<svelte:options immutable={true} />

<script>
  import {
    mdiAlertOutline,
    mdiCheckDecagramOutline,
    mdiTimerSand,
  } from "@mdi/js";
  import { waitForTransactionReceipt } from "@wagmi/core";
  import { isHex } from "viem";
  import { AppAnchor } from "$lib/components";
  import { Button, Icon } from "$lib/dusk/components";
  import { account, wagmiConfig } from "$lib/web3/walletConnection";
  import { migrate } from "$lib/web3/migration";
  import { createDataStore } from "$lib/dusk/svelte-stores";
  import { createEventDispatcher } from "svelte";
  import { walletStore } from "$lib/stores";

  /** @type {bigint} */
  export let amount;

  /** @type {string} */
  export let currentAddress;

  /** @type {HexString} */
  export let migrationContract;

  const dispatch = createEventDispatcher();

  /** @type {string} */
  let migrationHash = "";

  const migrationStore = createDataStore(handleMigration);

  $: ({ chain, chainId } = $account);
  $: ({ data, error, isLoading } = $migrationStore);

  /** @param {number} id - the chain id of the selected smart contract */
  async function handleMigration(id) {
    const txHash = await migrate(amount, id, currentAddress, migrationContract);

    if (isHex(txHash)) {
      migrationHash = txHash;
      const result = await waitForTransactionReceipt(wagmiConfig, {
        confirmations: 10,
        hash: txHash,
      });
      if (result.status === "success") {
        dispatch("incrementStep");
        setTimeout(() => {
          walletStore.sync().catch(() => {});
        }, 20000);
      } else {
        throw new Error("Could not validate the transaction receipt");
      }
    } else {
      throw new Error("txHash is not a hex string");
    }
  }
</script>

<div class="migrate__execute">
  {#if !isLoading && !data && !error}
    <div class="migrate__execute-approval">
      <Icon path={mdiCheckDecagramOutline} size="large" />
      <span>Approved.</span>
    </div>
  {:else if error}
    <div class="migrate__execute-approval">
      <Icon path={mdiAlertOutline} size="large" />
      <span>Rejected in your wallet.</span>
    </div>
  {:else if isLoading && !migrationHash}
    <div class="migrate__execute-approval">
      <Icon path={mdiTimerSand} size="large" />
      <span>Migrating…</span>
    </div>
  {/if}
  {#if migrationHash && chain?.blockExplorers}
    <div class="migrate__execute-approval">
      <Icon path={mdiTimerSand} size="large" />
      <span>Confirming the migration…</span>
      <AppAnchor
        className="text-link"
        href={`${chain.blockExplorers.default.url}/tx/${migrationHash}`}
        target="_blank"
        rel="noopener noreferrer">Track the transaction</AppAnchor
      >
    </div>
  {/if}
  {#if (isLoading || !data || error) && !migrationHash}
    <Button
      text={`${error ? "Retry" : "Execute"} migration`}
      disabled={!!isLoading}
      on:click={() => migrationStore.getData(chainId)}
    />
  {/if}
</div>

<style lang="postcss">
  .migrate__execute {
    display: flex;
    justify-content: center;
    flex-direction: column;
    gap: 1.875em;

    &-approval {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--default-gap);
    }
  }
</style>
