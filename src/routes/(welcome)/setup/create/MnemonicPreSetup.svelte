<script>
  import { Agreement, Card } from "$lib/dusk/components";

  /** @type {boolean} */
  export let isValid = false;

  /** @type {boolean} */
  let agreementOneChecked = isValid || false;

  /** @type {boolean} */
  let agreementTwoChecked = isValid || false;

  $: isValid = agreementOneChecked && agreementTwoChecked;
</script>

<Card gap="medium">
  <Agreement
    name="mnemonic_agreement_one"
    bind:checked={agreementOneChecked}
    label="Lose the phrase and you lose the wallet and its funds. Dusk doesn't keep it and can't restore it."
  />
  <Agreement
    name="mnemonic_agreement_two"
    bind:checked={agreementTwoChecked}
    label="Anyone with the phrase can take your DUSK. Dusk never asks for it."
  />
</Card>
