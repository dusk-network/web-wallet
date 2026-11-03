<script>
  import { mdiOpenInNew } from "@mdi/js";

  import { AnchorButton, CopyButton } from "$lib/dusk/components";

  import AppAnchorButton from "../AppAnchorButton/AppAnchorButton.svelte";
  import { shortened } from "./withdrawalPresentation";

  /** @type {string} */
  export let value;

  /** @type {string} */
  export let name;

  /** @type {string | null} */
  export let href = null;

  /** @type {string} */
  export let explorerName = "explorer";

  /** @type {boolean} */
  export let external = true;
</script>

<div class="withdrawal-hash">
  <code>{shortened(value)}</code>
  <span class="withdrawal-hash__actions">
    <CopyButton
      data-tooltip-id="main-tooltip"
      data-tooltip-text="Copy to clipboard"
      name={name.toLowerCase()}
      {value}
      variant="tertiary"
    />
    {#if href}
      {#if external}
        <AnchorButton
          aria-label={`View ${name.toLowerCase()} in ${explorerName}`}
          data-tooltip-id="main-tooltip"
          data-tooltip-text={`View in ${explorerName}`}
          {href}
          icon={{ path: mdiOpenInNew }}
          rel="noopener noreferrer"
          target="_blank"
          variant="tertiary"
        />
      {:else}
        <AppAnchorButton
          aria-label={`View ${name.toLowerCase()} in ${explorerName}`}
          data-tooltip-id="main-tooltip"
          data-tooltip-text={`View in ${explorerName}`}
          {href}
          icon={{ path: mdiOpenInNew }}
          variant="tertiary"
        />
      {/if}
    {/if}
  </span>
</div>

<style lang="postcss">
  .withdrawal-hash {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    min-width: 0;

    & code {
      overflow-wrap: anywhere;
    }

    &__actions {
      align-items: center;
      display: flex;
      flex-shrink: 0;
      gap: 0.5rem;
    }
  }
</style>
