<script>
  import { AppAnchorButton } from "$lib/components";
  import { Suspense } from "$lib/dusk/components";
  import { isHistoryEnabled } from "$lib/activity";
  import { describeFailure, isOutcomeUnknown } from "$lib/transactions";

  import DepositProgress from "../EvmTransactions/DepositProgress.svelte";

  /** @type {Promise<string>} */
  export let operation;
</script>

<Suspense
  className="deposit-result"
  describeError={describeFailure}
  errorMessage="Deposit submission failed"
  gap="large"
  pendingMessage="Submitting on DuskDS"
  waitFor={operation}
>
  <svelte:fragment slot="success-content" let:result={transactionHash}>
    <DepositProgress {transactionHash} />
  </svelte:fragment>
  <svelte:fragment slot="error-extra-content" let:error>
    {#if isHistoryEnabled() && isOutcomeUnknown(error)}
      <AppAnchorButton
        href="/dashboard/transactions"
        text="Open History"
        variant="secondary"
      />
    {:else}
      <AppAnchorButton href="/dashboard" text="Home" variant="tertiary" />
    {/if}
  </svelte:fragment>
</Suspense>

<style lang="postcss">
  :global {
    .deposit-result {
      padding: 1.5em 0;
      width: 100%;
    }
  }
</style>
