<script>
  import { Button } from "$lib/dusk/components";
  import { GasControls, GasFee } from "$lib/components";
  import { areValidGasSettings } from "$lib/contracts";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { section } from "$lib/dusk/motion";
  import { createNumberFormatter } from "$lib/dusk/number";
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
  $: formatGas = createNumberFormatter(language);

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
  <!-- It opens and closes the same way. -->
  {#if isExpanded}
    <div class="gas-settings" transition:section={{ open: isExpanded }}>
      <!-- What the fee is, in DUSK, before the gas that makes it. -->
      <p class="gas-settings__exact">
        <span class="gas-settings__most"
          >{formatDuskExact(fee, language)} DUSK at most</span
        >: it pays only for the gas used, up to {formatGas(limit)} gas at {formatGas(
          price
        )}
        LUX each.
      </p>
      <GasControls
        on:gasSettings
        {limit}
        {limitLower}
        {limitUpper}
        {price}
        {priceLower}
      />
      <!-- What else a review keeps folded away with the gas. -->
      <slot />
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

  /* The gas limit times its price, to copy, and what it is. */
  .gas-settings__exact {
    margin: 0;
    color: var(--muted-color);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .gas-settings__most {
    color: var(--calm-text);
    font-variant-numeric: tabular-nums;
    user-select: text;
  }
</style>
