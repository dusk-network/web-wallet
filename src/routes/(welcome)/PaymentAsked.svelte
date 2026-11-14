<svelte:options immutable={true} />

<script>
  /**
   * What a payment link asks, before a wallet opens to pay it: the amount, the
   * account it pays, by its verified .dusk name where it has one, and the
   * memo, as Send reads them. Nothing for a page that isn't a request, and
   * of one Send refuses, only why.
   */
  import {
    linkAmount,
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
   * Whether a wallet is kept here, which unlocks to pay it: the way in, before
   * any elsewhere.
   */
  export let hasWallet = false;

  /**
   * Whether it offers to pay it from a wallet elsewhere first: the Dusk
   * extension, where it takes the request and no wallet is kept here.
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
  // A link to Send that names whom it pays, read or refused: what an
  // extension may take.
  const isLink = link?.form === "https" && Boolean(link.to);
  // A request, by its fields, whether or not it can be read.
  const isRequest = asksPayment(place);

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

    if (isLink) {
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
  // What it asks, as Send reads it: nothing of one it refuses, whose To or
  // amount could read as what it isn't.
  $: asked = !problem && read?.link?.to ? read.link : null;
  // Its amount as Send's field holds it, filled in from the link, and reads
  // it: the amount, or the question Send asks of one that could be either of
  // two, as 1.000. Never settled here.
  $: amount = asked ? linkAmount(asked, language) : null;
  // The name the account it pays goes by, as the chain says: none for a
  // shielded address, or where the lookup fails.
  $: name =
    asked && recipientKind(asked.to) === "public"
      ? getPrimaryName(
          asked.to,
          String($networkStore.networkName),
          nodeBaseUrl()
        ).catch(() => "")
      : Promise.resolve("");
  // Another network's request, on the web wallet of its network.
  $: elsewhere =
    read?.reason === "other-network" ? elsewhereLink(opened) : null;
  // On Android, the wallet that pays it may be in Firefox, or the Dusk app,
  // which opens the request link itself where it's installed: the same
  // request there, after the way that works in this browser.
  $: offersPhone = Boolean(isAndroid && asked);
  // The extension that takes it, for a link Send would take: the wallet the
  // person has, where none is kept here, until it says it has none.
  $: offersExtension = Boolean(
    extension &&
    handed !== "refused" &&
    read?.reason !== "unreadable" &&
    read?.reason !== "two-amounts" &&
    problem !== LINK_BAD_ADDRESS
  );
  $: extensionFirst = offersExtension && !hasWallet && handed !== "no-wallet";
  $: offersElsewhere = extensionFirst;
  // Made again from the amount read: not for one Send asks about, which it
  // would hand on settled.
  $: appHref =
    offersPhone && asked && !amount?.problem
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
        <div>
          <dt>Amount</dt>
          <dd>
            {#if amount?.problem}
              <!-- No field here: the question alone, Send asks it after. -->
              <span>{amount.field} DUSK</span>
              <span class="payment-asked__question"
                >{amount.question ?? amount.problem}</span
              >
            {:else}
              {amount?.lux
                ? `${formatDuskExact(amount.lux, language)} DUSK`
                : "Any amount"}
            {/if}
          </dd>
        </div>
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
    <p class="payment-asked__next">
      {problem || (extensionFirst ? "Pay it with the Dusk extension." : next)}
    </p>
    {#if elsewhere}
      <AnchorButton
        className="payment-asked__open payment-asked__extension"
        href={elsewhere.href}
        text={`Switch to ${elsewhere.network}`}
        variant="secondary"
      />
    {/if}
    <!-- Not for a link no Send takes; another network's is the extension's to say. -->
    {#if offersExtension}
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
          className={extensionFirst
            ? "payment-asked__open"
            : "payment-asked__extension"}
          on:click={hand}
          text="Open in the Dusk extension"
          variant={extensionFirst ? "primary" : "secondary"}
        />
      {/if}
    {/if}
    <!-- The app, where it's installed, opens the link before this page does:
      here, it's another way, after the one that works in this browser. -->
    {#if offersPhone}
      {#if appHref}
        <AnchorButton
          className="payment-asked__open payment-asked__extension"
          href={appHref}
          text="Open in the Dusk app"
          variant="secondary"
        />
      {/if}
      {#if !isFirefox}
        <AnchorButton
          className="payment-asked__open payment-asked__extension"
          href={inFirefox(opened)}
          text="Open in Firefox"
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

  .payment-asked__question {
    color: var(--calm-danger);
    font-size: 0.8125rem;
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
