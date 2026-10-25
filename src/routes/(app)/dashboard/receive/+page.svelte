<svelte:options immutable={true} />

<script>
  import {
    mdiArrowBottomLeftThin,
    mdiArrowLeft,
    mdiShieldLock,
    mdiShieldLockOpenOutline,
  } from "@mdi/js";

  import { shieldedStatusStore, walletStore } from "$lib/stores";
  import {
    AppAnchorButton,
    Receive,
    ShieldedPausedNotice,
  } from "$lib/components";
  import { ExclusiveChoice } from "$lib/dusk/components";
  import { IconHeadingCard } from "$lib/containers/Cards";

  let addressToShow = "public";

  const options = [
    { disabled: false, label: "Public", value: "public" },
    { disabled: false, label: "Shielded", value: "shielded" },
  ];

  /** @type {"account" | "address"} */
  $: addressProp = addressToShow === "public" ? "account" : "address";
  $: ({ currentProfile } = $walletStore);
  $: ({ isPaused: isShieldedPaused } = $shieldedStatusStore);
  $: currentAddress = currentProfile
    ? currentProfile[addressProp].toString()
    : "";
  $: icons = [
    mdiArrowBottomLeftThin,
    addressToShow === "public" ? mdiShieldLockOpenOutline : mdiShieldLock,
  ];
</script>

<IconHeadingCard gap="medium" heading="Receive" {icons}>
  <ExclusiveChoice {options} bind:value={addressToShow} />
  {#if addressToShow === "shielded" && isShieldedPaused}
    <ShieldedPausedNotice />
    <AppAnchorButton
      href="/dashboard"
      icon={{ path: mdiArrowLeft }}
      text="Back"
      variant="tertiary"
    />
  {:else}
    <Receive address={currentAddress} />
  {/if}
</IconHeadingCard>
