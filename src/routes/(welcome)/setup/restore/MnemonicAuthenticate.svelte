<script>
  import { MnemonicInput } from "$lib/components";
  import { IconHeadingCard } from "$lib/containers/Cards";

  /** @type {boolean} */
  export let isValid = false;

  /** @type {string[]} */
  export let enteredMnemonicPhrase = [];

  // The words the boxes start with: the phrase typed to unlock, if any.
  const initialWords = enteredMnemonicPhrase;

  /** @type {string} */
  let mnemonic = enteredMnemonicPhrase.join(" ").trim();

  $: enteredMnemonicPhrase = mnemonic ? mnemonic.split(" ") : [];
</script>

<IconHeadingCard gap="medium" heading="Enter your recovery phrase">
  <MnemonicInput bind:isValid bind:mnemonic {initialWords} />
</IconHeadingCard>
