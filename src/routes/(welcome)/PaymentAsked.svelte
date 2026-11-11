<svelte:options immutable={true} />

<script>
  /**
   * What a payment link asks, before a wallet opens to pay it: the amount, the
   * account it pays, by its verified .dusk name where it has one, and the
   * memo, as the link says them. Nothing for a page that isn't a request.
   */
  import {
    makePaymentLink,
    parsePaymentLink,
    readPaymentLink,
    recipientKind,
  } from "@dusk-network/app-core/payment-links";

  import { onMount } from "svelte";

  import { MemoText } from "$lib/components";
  import { AnchorButton, Button } from "$lib/dusk/components";
  import { getPrimaryName } from "$lib/dusk-domains";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { shortenAddress } from "$lib/dusk/string";
  import { peekPlace } from "$lib/navigation";
  import {
    LINK_BAD_ADDRESS,
    asksPayment,
    elsewhereLink,
    inFirefox,
    isBrokenAddress,
    ownWalletUrl,
  } from "$lib/payment-requests";
  import {
    findLinkTaker,
    openInExtension,
  } from "$lib/payment-requests/extension";
  import { networkStore, settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import { nodeBaseUrl } from "$lib/url";

  /** What to do to pay it, as "Unlock to pay it." */
  /** @type {string} */
  export let next;

  /**
   * Whether it offers to pay it from a wallet elsewhere on this phone first:
   * Firefox's, or the Dusk app.
   */
  export let offersElsewhere = false;

  /** An Android phone, whose browser opens a link tapped in another app. */
  const isAndroid =
    typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const isFirefox =
    typeof navigator !== "undefined" && /Firefox\//.test(navigator.userAgent);

  const place = peekPlace();
  const opened =
    place && /^\/dashboard\/send\/?\?/.test(place)
      ? `${ownWalletUrl()}${place}`
      : "";
  const link = opened
    ? parsePaymentLink(opened, { walletUrl: ownWalletUrl() })
    : null;
  const asked = link?.form === "https" && link.to ? link : null;
  // A request, by its fields, whether or not it can be read.
  const isRequest = asksPayment(place);

  // The name the account it pays goes by, as the chain says: none for a
  // shielded address, or where the lookup fails.
  const name =
    asked && recipientKind(asked.to) === "public"
      ? getPrimaryName(
          asked.to,
          String($networkStore.networkName),
          nodeBaseUrl()
        ).catch(() => "")
      : Promise.resolve("");

  /**
   * The Dusk Wallet extension, where one takes the request: it pays it from
   * its own Send, on its own network.
   *
   * @type {import("$lib/payment-requests/extension").DuskProvider | null}
   */
  let extension = null;

  /** What handing it to the extension did. */
  let handed = "";

  onMount(() => {
    let isHere = true;

    if (asked) {
      findLinkTaker().then((found) => {
        if (isHere) {
          extension = found;
        }
      });
    }

    return () => {
      isHere = false;
    };
  });

  async function hand() {
    if (extension) {
      handed = await openInExtension(extension, opened);
    }
  }

  $: ({ language } = $settingsStore);
  // Why it can't be paid as it is, as Send says once it opens: two amounts,
  // or another network.
  $: read = isRequest
    ? readPaymentLink(opened, {
        network: $nodeNetwork ?? undefined,
        walletUrl: ownWalletUrl(),
      })
    : null;
  // An address cut short on its way says so before an unlock, not after.
  $: problem =
    read?.problem ||
    (read?.link && isBrokenAddress(read.link.to) ? LINK_BAD_ADDRESS : "");
  // Another network's request, on the web wallet of its network.
  $: elsewhere =
    read?.reason === "other-network" ? elsewhereLink(opened) : null;
  // On Android, the wallet that pays it may be in Firefox, or the Dusk app:
  // the same request, there, before a wallet is made or restored here.
  $: offersElsewhere = Boolean(isAndroid && asked && !problem);
  $: appHref =
    offersElsewhere && asked
      ? makePaymentLink({
          amountLux: asked.lux,
          label: asked.label || null,
          memo: asked.memo || null,
          network: $nodeNetwork ?? (asked.chainId || null),
          to: asked.to,
        }).dusk
      : "";
</script>

<!-- One that can't be read, as one saying a field twice, says only why. -->
{#if asked || problem}
  <section aria-labelledby="payment-asked" class="payment-asked">
    <h2 class="payment-asked__title" id="payment-asked">Payment request</h2>
    {#if asked}
      <dl class="payment-asked__facts">
        {#if read?.reason !== "two-amounts"}
          <div>
            <dt>Amount</dt>
            <dd>
              {asked.lux === null
                ? "Any amount"
                : `${formatDuskExact(asked.lux, language)} DUSK`}
            </dd>
          </div>
        {/if}
        <div>
          <dt>To</dt>
          <dd>
            {#await name then found}
              {#if found}
                <span class="payment-asked__name">{found}</span>
              {/if}
            {/await}
            <span class="payment-asked__code" title={asked.to}
              >{shortenAddress(asked.to)}</span
            >
          </dd>
        </div>
        {#if asked.memo}
          <div>
            <dt>Memo</dt>
            <dd><MemoText text={asked.memo} /></dd>
          </div>
        {/if}
      </dl>
    {/if}
    {#if offersElsewhere}
      {#if !isFirefox}
        <AnchorButton
          className="payment-asked__open"
          href={inFirefox(opened)}
          text="Open in Firefox"
        />
      {/if}
      {#if appHref}
        <AnchorButton
          className="payment-asked__open payment-asked__extension"
          href={appHref}
          text="Open in the Dusk app"
          variant="secondary"
        />
      {/if}
    {/if}
    <p class="payment-asked__next">{problem || next}</p>
    {#if elsewhere}
      <AnchorButton
        className="payment-asked__open payment-asked__extension"
        href={elsewhere.href}
        text={`Switch to ${elsewhere.network}`}
        variant="secondary"
      />
    {/if}
    <!-- Not for a link no Send takes; another network's is the extension's to say. -->
    {#if extension && handed !== "refused" && read?.reason !== "unreadable" && read?.reason !== "two-amounts" && problem !== LINK_BAD_ADDRESS}
      {#if handed === "opened"}
        <p class="payment-asked__next" role="status">
          Opened in the Dusk extension.
        </p>
      {:else if handed === "no-wallet"}
        <p class="payment-asked__next" role="status">
          The Dusk extension has no wallet to pay with.
        </p>
      {:else}
        <Button
          className="payment-asked__extension"
          on:click={hand}
          text="Open in the Dusk extension"
          variant="secondary"
        />
      {/if}
    {/if}
  </section>
{/if}

<style lang="postcss">
  .payment-asked {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--surface-border-color);
    border-radius: var(--control-border-radius-size);
    background-color: var(--surface-soft-color);
  }

  .payment-asked__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .payment-asked__facts {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;

    & div {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }

    & dt {
      color: var(--calm-muted);
    }

    & dd {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
      text-align: right;
    }
  }

  .payment-asked__name {
    font-weight: 500;
  }

  .payment-asked__code {
    color: var(--calm-muted);
    font-family: var(--code-font-family);
    font-size: 0.8125rem;
  }

  .payment-asked__next {
    margin: 0;
  }

  /* A button on the card, which is its own colour. */
  .payment-asked :global(.payment-asked__extension) {
    background-color: var(--calm-field);
  }

  .payment-asked :global(.payment-asked__open) {
    width: 100%;
  }
</style>
