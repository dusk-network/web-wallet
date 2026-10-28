<script>
  import { luxToDusk } from "$lib/dusk/currency";

  /** @type {bigint} */
  export let fee;

  /** @type {(amount: number) => string} */
  export let formatter;
</script>

<div class="gas-fee">
  <span>Network fee (at most)</span>
  <span class="gas-fee__amount">
    <span class="gas-fee__amount-value">{formatter(luxToDusk(fee))}</span>
    DUSK
  </span>
</div>

<style lang="postcss">
  .gas-fee {
    display: inline-flex;
    justify-content: flex-start;
    align-items: center;
    gap: var(--small-gap);
    flex-wrap: wrap;

    &__amount {
      font-weight: 500;
    }
  }
</style>
