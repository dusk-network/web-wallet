<script>
  /**
   * The recovery words, to write down: hidden the moment the page is
   * (onPageHidden), until Show words.
   */
  import { onMount } from "svelte";

  import { Button, Words } from "$lib/dusk/components";
  import { WarningCard } from "$lib/containers/Cards";
  import onPageHidden from "$lib/security/onPageHidden";
  import { generateMnemonic } from "$lib/wallet";

  /** @type {string[]} */
  export let mnemonicPhrase;

  /** What each word shows as while they're hidden. */
  const HIDDEN_WORD = "•••••";

  /** Whether the words are hidden, as the page was: until Show words. */
  let isHidden = false;

  if (mnemonicPhrase.length === 0) {
    mnemonicPhrase = generateMnemonic().split(" ");
  }

  onMount(() =>
    onPageHidden(() => {
      isHidden = true;
    })
  );

  $: shown = isHidden ? mnemonicPhrase.map(() => HIDDEN_WORD) : mnemonicPhrase;
</script>

<WarningCard heading="Keep it safe">
  <p class="mnemonic-card__notice">
    Please make sure to write your phrase down and save it in a secure location.
  </p>
  <Words words={shown} />
  {#if isHidden}
    <Button
      className="mnemonic-card__show"
      on:click={() => {
        isHidden = false;
      }}
      text="Show words"
      variant="secondary"
    />
  {/if}
</WarningCard>

<style lang="postcss">
  .mnemonic-card__notice {
    margin-bottom: var(--small-gap);
  }

  :global(.mnemonic-card__show) {
    margin-top: var(--small-gap);
  }
</style>
