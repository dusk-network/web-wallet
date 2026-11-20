<script>
  import { Agreement } from "$lib/dusk/components";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { Banner } from "$lib/components";

  /** @type {boolean} */
  export let isValid = false;

  /** @type {boolean} */
  let agreementOneChecked = isValid || false;

  /** @type {boolean} */
  let agreementTwoChecked = isValid || false;

  $: isValid = agreementOneChecked && agreementTwoChecked;
</script>

<IconHeadingCard gap="medium" heading="Keep it safe">
  <Agreement
    name="mnemonic_agreement_one"
    bind:checked={agreementOneChecked}
    label="I understand that without my recovery phrase I cannot access my wallet and its assets."
  />
  <Agreement
    name="mnemonic_agreement_two"
    bind:checked={agreementTwoChecked}
    label="Anyone with these 12 words can take my DUSK. Dusk will never ask for them."
  />
</IconHeadingCard>

<Banner
  title="Dusk will not save and cannot retrieve your recovery phrase."
  variant="warning"
>
  <p>Tick both boxes to continue.</p>
</Banner>
