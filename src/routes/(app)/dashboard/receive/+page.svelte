<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";
  import {
    mdiArrowBottomLeftThin,
    mdiShieldLock,
    mdiShieldLockOpenOutline,
  } from "@mdi/js";

  import { getPrimaryName } from "$lib/dusk-domains";
  import { networkStore, walletStore } from "$lib/stores";
  import { Receive } from "$lib/components";
  import { ExclusiveChoice } from "$lib/dusk/components";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { makeNodeUrl } from "$lib/url";

  let addressToShow = "public";
  let isMounted = false;

  const options = [
    { disabled: false, label: "Public", value: "public" },
    { disabled: false, label: "Shielded", value: "shielded" },
  ];

  onMount(() => {
    isMounted = true;
  });

  /** @type {"account" | "address"} */
  $: addressProp = addressToShow === "public" ? "account" : "address";
  $: ({ currentProfile } = $walletStore);
  $: ({ networkName } = $networkStore);
  $: currentAddress = currentProfile
    ? currentProfile[addressProp].toString()
    : "";
  $: icons = [
    mdiArrowBottomLeftThin,
    addressToShow === "public" ? mdiShieldLockOpenOutline : mdiShieldLock,
  ];

  // The name shown with the address, looked up once the page has rendered:
  // the public account's verified primary name, which the shielded address
  // shows only if the name pays to it as well.
  $: name =
    isMounted && currentProfile
      ? getPrimaryName(
          currentProfile.account.toString(),
          networkName,
          makeNodeUrl().origin,
          addressProp === "address" ? currentAddress : undefined
        )
      : "";
</script>

<IconHeadingCard gap="medium" heading="Receive" {icons}>
  <ExclusiveChoice {options} bind:value={addressToShow} />
  <Receive address={currentAddress} {name} />
</IconHeadingCard>
