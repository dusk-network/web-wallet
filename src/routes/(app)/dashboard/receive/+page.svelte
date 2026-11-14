<svelte:options immutable={true} />

<script>
  import { onMount } from "svelte";

  import { getPrimaryName } from "$lib/dusk-domains";
  import { rememberRequest } from "$lib/payment-requests";
  import { networkStore, walletStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import { PaymentRequests, Receive, RequestPayment } from "$lib/components";
  import { ExclusiveChoice } from "$lib/dusk/components";
  import { PageCard } from "$lib/containers/Cards";
  import { nodeBaseUrl } from "$lib/url";
  import { openProfileNames } from "$lib/wallets";

  let addressToShow = "public";
  let isMounted = false;

  /** What's asked of whoever pays, once it can be paid. */
  /** @type {{ dusk: string, link: string, lux: bigint | null, memo: string } | null} */
  let request = null;

  const options = [
    { disabled: false, label: "Public", value: "public" },
    { disabled: false, label: "Shielded", value: "shielded" },
  ];

  onMount(() => {
    isMounted = true;
  });

  /**
   * Keeps what's asked in the list as it leaves the wallet: what left, or
   * what's on screen.
   *
   * @param {{ address: string, request: { lux?: bigint | null, memo?: string } | null }} [used]
   */
  function keepRequest(used = { address: currentAddress, request }) {
    if (used.request) {
      rememberRequest({
        lux: used.request.lux ?? null,
        memo: used.request.memo ?? "",
        network: $nodeNetwork?.name ?? "",
        to: used.address,
      });
    }
  }

  /** The verified .dusk name of the profile shown, once looked up: "" for none. */
  let verifiedName = "";

  /**
   * Takes the name a lookup gives, unless another was asked for since.
   *
   * @param {string | Promise<string>} asked
   */
  function takeName(asked) {
    verifiedName = "";
    Promise.resolve(asked).then(
      (found) => {
        if (asked === name) {
          verifiedName = found || "";
        }
      },
      () => {}
    );
  }

  /** @type {"account" | "address"} */
  $: addressProp = addressToShow === "public" ? "account" : "address";
  $: ({ currentProfile, profiles } = $walletStore);
  $: ({ networkName } = $networkStore);
  $: currentAddress = currentProfile
    ? currentProfile[addressProp].toString()
    : "";
  // The name shown with the address, looked up once the page has rendered:
  // the public account's verified primary name, which the shielded address
  // shows only if the name pays to it as well.
  $: name =
    isMounted && currentProfile
      ? getPrimaryName(
          currentProfile.account.toString(),
          networkName,
          nodeBaseUrl(),
          addressProp === "address" ? currentAddress : undefined
        )
      : "";
  $: takeName(name);
  // Whose a request is, as Share and Copy say it: the verified .dusk name,
  // else the name given the profile here, none for one known by its number.
  $: requestName =
    verifiedName ||
    (currentProfile
      ? ($openProfileNames[profiles.indexOf(currentProfile)] ?? "")
      : "");
</script>

<PageCard gap="medium" heading="Receive">
  <ExclusiveChoice {options} bind:value={addressToShow} />
  <Receive
    address={currentAddress}
    addressType={addressProp}
    {name}
    onUse={keepRequest}
    {request}
    {requestName}
  >
    <RequestPayment
      address={currentAddress}
      bind:request
      onUse={keepRequest}
      {requestName}
    />
    {#if currentProfile}
      <PaymentRequests
        addresses={[
          currentProfile.account.toString(),
          currentProfile.address.toString(),
        ]}
      />
    {/if}
  </Receive>
</PageCard>
