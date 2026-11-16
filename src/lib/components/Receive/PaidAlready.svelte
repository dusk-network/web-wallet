<svelte:options immutable={true} />

<script>
  /**
   * Asked where a request paid already is about to be given out again, by
   * Copy, Share or Download QR, right where it was pressed: "This request was
   * paid already, on <date>." with "Copy anyway" (or Share, or Download) and
   * Cancel. Only its "anyway" gives it out. Never a toast: nothing hides it,
   * and it comes into view as it's asked, as on a phone it can open below the
   * screen's edge.
   */
  import { onMount } from "svelte";

  import { paidInSentence } from "$lib/activity/present";
  import { Button } from "$lib/dusk/components";
  import { settingsStore } from "$lib/stores";

  import Banner from "../Banner/Banner.svelte";

  /** When it was paid. */
  /** @type {number} */
  export let at;

  /** What's given out, as in "Copy anyway". */
  /** @type {"Copy" | "Download" | "Share"} */
  export let verb;

  /** Gives it out all the same. */
  /** @type {() => void} */
  export let onAnyway;

  /** Gives nothing out. */
  /** @type {() => void} */
  export let onCancel;

  /** @type {HTMLElement} */
  let element;

  onMount(() => {
    element?.scrollIntoView?.({ block: "nearest" });
  });

  $: ({ language } = $settingsStore);
</script>

<div bind:this={element} class="paid-already">
  <Banner
    className="paid-already__banner"
    role="alert"
    title={`This request was paid already, ${paidInSentence(at, language)}.`}
    variant="warning"
  >
    <div class="paid-already__actions">
      <Button
        on:click={onAnyway}
        size="small"
        text={`${verb} anyway`}
        variant="secondary"
      />
      <Button
        on:click={onCancel}
        size="small"
        text="Cancel"
        variant="tertiary"
      />
    </div>
  </Banner>
</div>

<style lang="postcss">
  .paid-already__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
