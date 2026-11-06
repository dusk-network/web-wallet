<svelte:options immutable={true} />

<script>
  /**
   * What a payment link asks, before a wallet opens to pay it: the amount, the
   * account it pays, by its verified .dusk name where it has one, and the
   * memo, as the link says them. Nothing for a page that isn't a request.
   */
  import {
    parsePaymentLink,
    readPaymentLink,
    recipientKind,
  } from "@dusk-network/app-core/payment-links";

  import { MemoText } from "$lib/components";
  import { getPrimaryName } from "$lib/dusk-domains";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { shortenAddress } from "$lib/dusk/string";
  import { peekPlace } from "$lib/navigation";
  import { ownWalletUrl } from "$lib/payment-requests";
  import { networkStore, settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import { nodeBaseUrl } from "$lib/url";

  /** What to do to pay it, as "Unlock to pay it." */
  /** @type {string} */
  export let next;

  const place = peekPlace();
  const opened =
    place && /^\/dashboard\/send\/?\?/.test(place)
      ? `${ownWalletUrl()}${place}`
      : "";
  const link = opened
    ? parsePaymentLink(opened, { walletUrl: ownWalletUrl() })
    : null;
  const asked = link?.form === "https" && link.to ? link : null;

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

  $: ({ language } = $settingsStore);
  // Why it can't be paid as it is, as Send says once it opens: two amounts,
  // or another network.
  $: read = asked
    ? readPaymentLink(opened, {
        network: $nodeNetwork ?? undefined,
        walletUrl: ownWalletUrl(),
      })
    : null;
  $: problem = read?.problem ?? "";
</script>

{#if asked}
  <section aria-labelledby="payment-asked" class="payment-asked">
    <h2 class="payment-asked__title" id="payment-asked">Payment request</h2>
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
    <p class="payment-asked__next">{problem || next}</p>
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
</style>
