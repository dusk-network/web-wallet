<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { BigIntInput } from "$lib/components";
  import { createNumberFormatter } from "$lib/dusk/number";
  import { randomUUID } from "$lib/dusk/string";
  import { settingsStore } from "$lib/stores";

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

  /** @type {boolean} */
  export let showLimit = true;

  const dispatch = createEventDispatcher();
  const id = randomUUID();

  function dispatchGasLimits() {
    dispatch("gasSettings", {
      limit: limit,
      price: price,
    });
  }

  onMount(() => {
    dispatchGasLimits();
  });

  $: formatGas = createNumberFormatter($settingsStore.language);

  // What is wrong with each value, said while it is typed.
  $: priceMessage =
    price < priceLower
      ? `The minimum is ${formatGas(priceLower)} LUX.`
      : price > limit
        ? "It can't be higher than the gas limit."
        : "";
  $: limitMessage =
    limit < limitLower
      ? `The minimum is ${formatGas(limitLower)}.`
      : limit > limitUpper
        ? `The maximum is ${formatGas(limitUpper)}.`
        : "";
</script>

<div class="gas-control">
  <label class="gas-control__label" for="{id}-price">Gas price (LUX)</label>
  <BigIntInput
    aria-describedby={priceMessage ? `${id}-price-message` : undefined}
    aria-invalid={Boolean(priceMessage)}
    bind:value={price}
    className="gas-control__input"
    id="{id}-price"
    maxValue={limit}
    minValue={priceLower}
    on:change={dispatchGasLimits}
    required
  />
  {#if priceMessage}
    <p class="gas-control__message" id="{id}-price-message">{priceMessage}</p>
  {/if}
</div>

{#if showLimit}
  <div class="gas-control">
    <label class="gas-control__label" for="{id}-limit">Gas limit</label>
    <BigIntInput
      aria-describedby={limitMessage ? `${id}-limit-message` : undefined}
      aria-invalid={Boolean(limitMessage)}
      bind:value={limit}
      className="gas-control__input"
      id="{id}-limit"
      maxValue={limitUpper}
      minValue={limitLower}
      on:change={dispatchGasLimits}
      required
    />
    {#if limitMessage}
      <p class="gas-control__message" id="{id}-limit-message">
        {limitMessage}
      </p>
    {/if}
  </div>
{/if}

<style lang="postcss">
  .gas-control {
    display: flex;
    gap: 0.5em;
    width: 100%;
    flex-direction: column;
    justify-content: start;
    align-items: stretch;

    &__label {
      color: var(--muted-color);
      font-size: 0.875rem;
      line-height: 140%;
    }

    &__message {
      color: var(--badge-error-color);
      font-size: 0.875em;
      line-height: 1.4;
    }
  }
</style>
