<script>
  import { formatFee } from "$lib/dusk/currency";
  import { settingsStore } from "$lib/stores";

  /** @type {bigint} */
  export let fee;

  $: ({ language } = $settingsStore);
</script>

<div class="gas-fee">
  <span>Network fee (at most)</span>
  <span class="gas-fee__amount">
    <span class="gas-fee__amount-value"
      >{formatFee(fee, language, { max: true })}</span
    >
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
