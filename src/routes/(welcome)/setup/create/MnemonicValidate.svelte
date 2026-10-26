<script>
  import { Mnemonic } from "$lib/dusk/components";
  import { arraysEqual, shuffleArray } from "$lib/dusk/array";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { Banner } from "$lib/components";

  /** @type {boolean} */
  export let isValid = false;

  /** @type {string[]} */
  export let enteredMnemonicPhrase = [];

  /** @type {string[]} */
  export let mnemonicPhrase = [];

  $: filteredMnemonic = new Set(
    enteredMnemonicPhrase.filter((word) => word !== "")
  );
  $: isValid = arraysEqual(enteredMnemonicPhrase, mnemonicPhrase);
</script>

<IconHeadingCard heading="Verification" gap="medium">
  <p>Tap the words in the order you wrote them down.</p>
  <Mnemonic
    bind:enteredMnemonicPhrase
    mnemonicPhrase={shuffleArray(mnemonicPhrase)}
    type="validate"
  />
  {#if filteredMnemonic.size === 12 && !isValid}
    <Banner title="The words don't match." variant="error">
      <p>Undo, and tap them in the order you wrote them down.</p>
    </Banner>
  {/if}
</IconHeadingCard>
