<svelte:options immutable={true} />

<script>
  /**
   * What an amount of DUSK comes to in the person's currency, as Settings
   * chooses it, at DUSK's price now, with the price's time: "≈ €1.82 · price
   * at 12:03". Nothing off mainnet, where DUSK has no value, nor for no
   * amount, nor while balances hide it.
   */
  import { readable } from "svelte/store";

  import { inCurrency, priceQuote } from "$lib/prices";
  import { settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";

  /**
   * The amount, in Lux: null for none.
   *
   * @type {bigint | null}
   */
  export let lux;

  /** Whether the amount is hidden with the balances. */
  export let hidden = false;

  /** @type {string | undefined} */
  export let className = undefined;

  /** No price, for none to show. */
  const none = readable(null);

  $: ({ currency, language } = $settingsStore);
  // DUSK's price in Settings' currency, read again while an amount shows:
  // none asked for without one, and none for another as it's typed.
  $: quote = hidden || !lux ? none : priceQuote(currency, $nodeNetwork);
  $: text = inCurrency(lux, $quote, { language })?.text ?? "";
</script>

{#if text}
  <span class={className ?? "amount-in-currency"}>{text}</span>
{/if}
