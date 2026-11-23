<svelte:options immutable={true} />

<script>
  /**
   * Shows an amount a review hides with the balances, when asked, for it to
   * be seen before it's confirmed, as recovery words are: on a phone
   * (touchOnly) only while this is held (holdToShow), on a computer once
   * it's pressed, until the page is hidden or left (onPageHidden).
   */
  import { onMount } from "svelte";

  import { Button } from "$lib/dusk/components";
  import { makeClassName } from "$lib/dusk/string";
  import holdToShow from "$lib/security/holdToShow";
  import onPageHidden from "$lib/security/onPageHidden";
  import { touchOnly } from "$lib/security/touchOnly";

  /** Whether the amount shows now. */
  export let shown = false;

  /** @type {string | undefined} */
  export let className = undefined;

  /** @param {boolean} isHeld */
  const hold = (isHeld) => {
    shown = isHeld;
  };

  onMount(() =>
    onPageHidden(() => {
      shown = false;
    }),
  );
</script>

{#if $touchOnly}
  <button
    aria-pressed={shown}
    class={makeClassName([
      "dusk-button",
      "dusk-button--type--button",
      "dusk-button--variant--secondary",
      "dusk-button--size--default",
      "show-amount",
      className,
    ])}
    type="button"
    use:holdToShow={hold}
  >
    <span class="dusk-button__text">Hold to show amount</span>
  </button>
{:else if !shown}
  <Button
    {className}
    on:click={() => {
      shown = true;
    }}
    text="Show amount"
    variant="secondary"
  />
{/if}

<style lang="postcss">
  /* Its long press is the hold: never a menu or a selection. */
  .show-amount {
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
</style>
