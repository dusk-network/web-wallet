<script>
  import { onMount } from "svelte";

  import {
    depositActivityStore,
    hydrateDepositActivity,
    trackDepositTransaction,
  } from "$lib/bridge/depositActivity";
  import { AppAnchorButton } from "$lib/components";

  import DepositLifecycle from "./DepositLifecycle.svelte";

  /** @type {string} */
  export let transactionHash;

  /** @type {any} */
  let deposit = null;

  onMount(() => {
    hydrateDepositActivity();
    const unsubscribe = depositActivityStore.subscribe((items) => {
      deposit =
        items.find((item) => item.transactionHash === transactionHash) ?? null;
    });

    void trackDepositTransaction(transactionHash);
    return unsubscribe;
  });
</script>

<div class="deposit-progress">
  <DepositLifecycle {deposit} />
  <div class="deposit-progress__actions">
    <AppAnchorButton
      href={`/dashboard/bridge/transactions?view=deposits&tx=${transactionHash}`}
      text="TRACK IN ACTIVITY"
    />
    <AppAnchorButton href="/dashboard" text="HOME" variant="tertiary" />
  </div>
</div>

<style lang="postcss">
  .deposit-progress {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    width: 100%;

    &__actions {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 30rem) {
    .deposit-progress__actions {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
