<svelte:options immutable={true} />

<script>
  /**
   * Shows an amount a review hides with the balances, when asked, for it to
   * be seen before it's confirmed: pressed by a mouse, a finger, a key or a
   * screen reader's double tap alike, which is a click. It stays shown until
   * this is pressed again, the review is left, or the page is hidden or left
   * (onPageHidden), and this stays where it was pressed, to hide it again.
   * As it shows, what shows is said (`said`) to a screen reader.
   */
  import { onMount } from "svelte";

  import { Button } from "$lib/dusk/components";
  import onPageHidden from "$lib/security/onPageHidden";

  /** Whether the amount shows now. */
  export let shown = false;

  /** What shows, said as it shows: the amount, and the total where there's one. */
  export let said = "";

  /** @type {string | undefined} */
  export let className = undefined;

  onMount(() =>
    onPageHidden(() => {
      shown = false;
    }),
  );
</script>

<Button
  {className}
  on:click={() => {
    shown = !shown;
  }}
  text={shown ? "Hide amount" : "Show amount"}
  variant="secondary"
/>
<span class="sr-only" role="status">{shown ? said : ""}</span>
