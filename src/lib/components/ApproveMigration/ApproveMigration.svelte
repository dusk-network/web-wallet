<svelte:options immutable={true} />

<script>
  import { mdiAlertOutline, mdiTimerSand } from "@mdi/js";
  import { waitForTransactionReceipt } from "@wagmi/core";
  import { isHex } from "viem";
  import { createEventDispatcher } from "svelte";
  import { Button, Icon } from "$lib/dusk/components";
  import { Banner } from "$lib/components";
  import { account, wagmiConfig } from "$lib/web3/walletConnection";
  import { allowance, approve } from "$lib/web3/migration";
  import { createDataStore } from "$lib/dusk/svelte-stores";

  /** @type {bigint} */
  export let amount;

  /** @type {HexString} */
  export let chainContract;

  /** @type {HexString} */
  export let migrationContract;

  $: ({ address } = $account);

  const dispatch = createEventDispatcher();

  const approvalTxStore = createDataStore(handleApprove);

  $: ({ isLoading, data, error } = $approvalTxStore);

  async function checkAllowance() {
    if (!address) {
      dispatch("errorApproval");
      throw new Error("Address is undefined");
    }

    try {
      const allowedAmount = await allowance(
        address,
        chainContract,
        migrationContract
      );
      return allowedAmount >= amount;
    } catch {
      return false;
    }
  }

  async function handleApprove() {
    try {
      dispatch("initApproval");

      // Check initial allowance
      let isCoinApproved = await checkAllowance();

      if (isCoinApproved) {
        dispatch("incrementStep");
        return;
      }

      // Approve the transaction
      const txHash = await approve(migrationContract, chainContract, amount);

      if (!isHex(txHash)) {
        throw new Error("Transaction hash is not a valid hex string.");
      }

      // Wait for transaction confirmation
      await waitForTransactionReceipt(wagmiConfig, {
        confirmations: 3,
        hash: txHash,
      });

      // Recheck allowance after approval
      isCoinApproved = await checkAllowance();
      if (isCoinApproved) {
        dispatch("incrementStep");
      } else {
        throw new Error("Approval failed: Allowance was not updated.");
      }
    } catch {
      dispatch("errorApproval");
    }
  }
</script>

<div class="migrate__approve">
  {#if !isLoading && !error && !data}
    <div class="migrate__approve-notice-container">
      <Banner
        title="Approving lets the migration contract take this amount."
        variant="info"
      />
      <Banner title="Your wallet pays gas for both steps." variant="warning" />
    </div>
  {:else if isLoading}
    <div class="migrate__approve-approval">
      <Icon path={mdiTimerSand} size="large" />
      <span>Approving…</span>
    </div>
  {:else if error}
    <div class="migrate__approve-approval">
      <Icon path={mdiAlertOutline} size="large" />
      <span>The approval didn't go through.</span>
    </div>
  {/if}

  <Button
    text={error ? "Retry approval" : "Approve migration"}
    disabled={!!isLoading}
    on:click={approvalTxStore.getData}
  />
</div>

<style lang="postcss">
  .migrate__approve {
    display: flex;
    justify-content: center;
    flex-direction: column;
    gap: 1.875em;

    &-notice-container {
      display: flex;
      flex-direction: column;
      gap: var(--default-gap);
    }

    &-approval {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--default-gap);
    }
  }
</style>
