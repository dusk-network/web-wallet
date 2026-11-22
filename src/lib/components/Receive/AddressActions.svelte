<svelte:options immutable={true} />

<script>
  /**
   * The address's own buttons on Receive, each named for what it gives: Copy
   * address, Share address where the browser has a share sheet, and Download
   * QR, of the QR shown.
   */
  import { mdiShareVariantOutline, mdiTrayArrowDown } from "@mdi/js";

  import { Button, CopyButton } from "$lib/dusk/components";

  /** @type {string} */
  export let address;

  /** Shares the address alone, where the browser has a share sheet. */
  /** @type {(() => void) | null} */
  export let onShare = null;

  /** Downloads the QR shown. */
  /** @type {() => void} */
  export let onDownload;
</script>

<div class="address-actions">
  <CopyButton
    className="address-actions__copy"
    name="address"
    text="Copy address"
    value={address}
    variant="secondary"
  />
  <div class="address-actions__row">
    {#if onShare}
      <Button
        icon={{ path: mdiShareVariantOutline }}
        on:click={onShare}
        text="Share address"
        variant="secondary"
      />
    {/if}
    <Button
      icon={{ path: mdiTrayArrowDown }}
      on:click={onDownload}
      text="Download QR"
      variant="secondary"
    />
  </div>
  <!-- What's asked of what they give, under them. -->
  <slot />
</div>

<style lang="postcss">
  .address-actions {
    display: flex;
    flex-direction: column;
    gap: var(--small-gap);
    width: 100%;

    & :global(.address-actions__copy) {
      width: 100%;
    }
  }

  /* Side by side where both fit, else each a row of its own. */
  .address-actions__row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--small-gap);
    width: 100%;

    & :global(.dusk-button) {
      flex: 1;
    }
  }
</style>
