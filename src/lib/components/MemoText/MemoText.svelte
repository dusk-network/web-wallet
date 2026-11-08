<svelte:options immutable={true} />

<script>
  /**
   * Text from someone else, as a memo, made safe to read: nothing in it can
   * reorder or hide what it says. What's hidden shows as a code, and it says so.
   * Right-to-left words and their digits are set apart, so what's beside them
   * reads in the order it's written: "Pay א 10 א 1000" never as
   * "Pay 1000 א 10 א". For display only: what's sent is the text as it is.
   */
  import { displayText } from "@dusk-network/app-core/text";

  /** @type {string} */
  export let text;

  /**
   * Quoted among other words: its line breaks show as codes too, and what
   * quotes it says once that it has hidden characters.
   */
  export let inline = false;

  $: shown = displayText(text, { isolate: true, lineBreaks: !inline });

  // Digits shown as they are, which can read as another number: N'Ko's 0001
  // as 1000, or 1٠5, whose Arabic-Indic zero looks like a point, as 1.5.
  $: rtl = shown.flags.includes("rtl_digits");
  $: digits = shown.flags.includes("mixed_digits")
    ? `It mixes kinds of digits${rtl ? ", some reading right to left" : ""}, so a number may not be what it looks like.`
    : rtl
      ? "Its digits read right to left, so a number may not be what it looks like."
      : "";
</script>

<!-- Nothing between the two: quoted, nothing comes after the text. -->
<span class="memo-text" class:memo-text--inline={inline} dir="ltr"
  >{shown.text}</span
>{#if shown.neutralized && !inline}<span class="memo-text__note"
    >It has hidden characters, shown here as codes.</span
  >{/if}{#if digits && !inline}<span class="memo-text__note">{digits}</span
  >{/if}

<style lang="postcss">
  /* It reads left to right on its own: nothing beside it moves its digits. */
  .memo-text {
    unicode-bidi: isolate;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .memo-text--inline {
    white-space: normal;
  }

  .memo-text__note {
    display: block;
    margin-top: 0.25rem;
    color: var(--calm-danger);
    font-size: 0.8125rem;
    text-align: left;
  }
</style>
