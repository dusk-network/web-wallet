<script>
  import { slide } from "svelte/transition";
  import { Button } from "$lib/dusk/components";
  import { GasControls, GasFee } from "$lib/components";
  import { areValidGasSettings } from "$lib/contracts";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { settingsStore } from "$lib/stores";
  import { onMount } from "svelte";

  /** @type {bigint} */
  export let limit;

  /** @type {bigint} */
  export let limitLower;

  /** @type {bigint} */
  export let limitUpper;

  /** @type {bigint} */
  export let price;

  /** @type {bigint} */
  export let priceLower;

  /** @type {bigint} */
  export let fee;

  /** @type {boolean} */
  let isExpanded = false;

  $: ({ language } = $settingsStore);

  onMount(() => {
    const bounds = {
      gasLimitLower: limitLower,
      gasLimitUpper: limitUpper,
      gasPriceLower: priceLower,
    };

    if (!areValidGasSettings(price, limit, bounds)) {
      isExpanded = true;
    }
  });
</script>

<div class="gas-settings">
  <dl class="gas-settings__edit">
    <GasFee {fee} />
    <dd>
      <Button
        size="small"
        variant="tertiary"
        on:click={() => {
          isExpanded = !isExpanded;
        }}
        text={isExpanded ? "Close" : "Edit"}
      />
    </dd>
  </dl>
  {#if isExpanded}
    <div in:slide|global class="gas-settings">
      <GasControls
        on:gasSettings
        {limit}
        {limitLower}
        {limitUpper}
        {price}
        {priceLower}
      />
      <dl class="gas-settings__exact">
        <dt>The most it can cost, exactly</dt>
        <dd>{formatDuskExact(fee, language)} DUSK</dd>
      </dl>
    </div>
  {/if}
</div>

<style lang="postcss">
  .gas-settings {
    display: flex;
    flex-direction: column;
    gap: 0.625em;
  }

  .gas-settings__edit {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }

  /* The gas limit times its price, to copy. */
  .gas-settings__exact {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.25em 1em;
    margin: 0;
    font-size: 0.875rem;

    & dt {
      color: var(--muted-color);
    }

    & dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
      user-select: text;
    }
  }
</style>
