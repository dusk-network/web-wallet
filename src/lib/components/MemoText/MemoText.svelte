<svelte:options immutable={true} />

<script>
  /**
   * Text from someone else, as a memo, made safe to read: nothing in it can
   * reorder or hide what it says. What's hidden shows as a code, and it says so.
   * For display only: what's sent is the text as it is.
   */
  import { displayText } from "@dusk-network/app-core/text";

  /** @type {string} */
  export let text;

  $: shown = displayText(text, { lineBreaks: true });
</script>

<span class="memo-text">{shown.text}</span>
{#if shown.neutralized}
  <span class="memo-text__note"
    >It has hidden characters, shown here as codes.</span
  >
{/if}

<style lang="postcss">
  .memo-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .memo-text__note {
    display: block;
    margin-top: 0.25rem;
    color: var(--calm-danger);
    font-size: 0.8125rem;
    text-align: left;
  }
</style>
