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

  /** Keeps what's asked in the list as it leaves the wallet. */
  function keepRequest() {
    if (request) {
      rememberRequest({
        lux: request.lux,
        memo: request.memo,
        network: $nodeNetwork?.name ?? "",
        to: currentAddress,
      });
    }
  }

  /** @type {"account" | "address"} */
  $: addressProp = addressToShow === "public" ? "account" : "address";
  $: ({ currentProfile } = $walletStore);
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
</script>

<PageCard gap="medium" heading="Receive">
  <ExclusiveChoice {options} bind:value={addressToShow} />
  <Receive
    address={currentAddress}
    addressType={addressProp}
    {name}
    onUse={keepRequest}
    {request}
  >
    <RequestPayment address={currentAddress} bind:request onUse={keepRequest} />
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
