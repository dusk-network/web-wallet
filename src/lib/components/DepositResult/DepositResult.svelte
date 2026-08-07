<script>
  import { AppAnchorButton } from "$lib/components";
  import { Suspense } from "$lib/dusk/components";

  import DepositProgress from "../EvmTransactions/DepositProgress.svelte";

  /** @type {Promise<string>} */
  export let operation;
</script>

<Suspense
  className="deposit-result"
  errorMessage="Deposit submission failed"
  gap="large"
  pendingMessage="Submitting on DuskDS"
  waitFor={operation}
>
  <svelte:fragment slot="success-content" let:result={transactionHash}>
    <DepositProgress {transactionHash} />
  </svelte:fragment>
  <AppAnchorButton
    href="/dashboard"
    slot="error-extra-content"
    text="HOME"
    variant="tertiary"
  />
</Suspense>

<style lang="postcss">
  :global {
    .deposit-result {
      padding: 1.5em 0;
      width: 100%;
    }
  }
</style>
