<svelte:options immutable={true} />

<script>
  /**
   * The requests this profile made, kept on this device, each marked by what
   * came in after it, in words that say what matched.
   */
  import { onDestroy } from "svelte";

  import { activityState, currentActivity } from "$lib/activity";
  import { claimDay } from "$lib/bridge/claimDate";
  import { Button, CopyButton } from "$lib/dusk/components";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import { addBasePath } from "$lib/navigation";
  import {
    forgetRequest,
    keepRequestMatches,
    makeRequestLink,
    matchRequests,
    requestsStore,
  } from "$lib/payment-requests";
  import { settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";

  import { BalanceValue, MemoText, SectionHead } from "..";

  /** The profile's public account and its shielded address. */
  /** @type {string[]} */
  export let addresses;

  /** @type {Record<string, string>} */
  const STATE_WORDS = { check: "Check", paid: "Paid", waiting: "Waiting" };

  /** How often the history is read again while this shows a request not paid. */
  const LOOK_MS = 30_000;

  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;

  /**
   * Reads the history for what's come in, while a request isn't paid: nothing
   * else does but a change of the balance, which may have come before this shows.
   *
   * @param {boolean} isOpen
   */
  function lookWhile(isOpen) {
    const look = () => {
      if (document.visibilityState !== "hidden") {
        void currentActivity()?.refresh();
      }
    };

    clearInterval(timer);
    timer = undefined;

    if (isOpen) {
      look();
      timer = setInterval(look, LOOK_MS);
    }
  }

  onDestroy(() => clearInterval(timer));

  /**
   * What matched of a payment that matched only part of a request, in words:
   * "same amount on 5 Nov, 21:16, with no memo".
   *
   * @param {{ at?: number, lux?: bigint, matched?: string, memo?: string }} payment
   * @param {string} language
   */
  function partOf({ at, lux, matched, memo }, language) {
    const day = at ? claimDay(at, language) : "";

    return matched === "amount"
      ? memo
        ? `same amount on ${day}, with another memo: "${memo}"`
        : `same amount on ${day}, with no memo`
      : hideBalances
        ? `same memo on ${day}`
        : `same memo on ${day}, for ${formatDuskExact(lux ?? 0n, language)} DUSK`;
  }

  /**
   * Days in a list: "a", "a and b", "a, b and c".
   *
   * @param {string[]} days
   */
  const listed = (days) =>
    days.length > 1
      ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}`
      : (days[0] ?? "");

  /**
   * What matched of a payment, in words, and of the others that match the
   * request too: paid twice, or another payment to check.
   *
   * @param {import("$lib/payment-requests/requests").RequestMatch} match
   * @param {string} language
   */
  function matchedText({ at, lux, matched, memo, more = [] }, language) {
    const day = at ? claimDay(at, language) : "";
    const again = more.filter((payment) => payment.matched === "amount-memo");
    const also = more
      .filter((payment) => payment.matched !== "amount-memo")
      .map((payment) => ` Also the ${partOf(payment, language)}.`)
      .join("");

    switch (matched) {
      case "amount-memo":
        return again.length
          ? `Paid ${again.length === 1 ? "twice" : `${again.length + 1} times`}: ${listed(
              [at, ...again.map((payment) => payment.at)].map((time) =>
                time ? claimDay(time, language) : "time not known"
              )
            )}.${also}`
          : day
            ? `Amount and memo match a payment on ${day}.${also}`
            : `Amount and memo match a payment.${also}`;
      case "amount":
      case "memo": {
        const part = partOf({ at, lux, matched, memo }, language);

        return `${part.charAt(0).toUpperCase()}${part.slice(1)}. Check it's this one.${also}`;
      }
      default:
        return "Nothing matching has come in.";
    }
  }

  /**
   * What a request asked, in words for a screen reader: nothing of it with the
   * balances hidden.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   */
  const amountOf = ({ lux }) =>
    lux === null
      ? "any amount"
      : hideBalances
        ? "a hidden amount"
        : `${formatDusk(BigInt(lux), language)} DUSK`;

  /**
   * A request's link, to copy again.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   */
  const linkOf = ({ lux, memo, to }) => {
    const made = makeRequestLink({ amountLux: lux, memo, to }, $nodeNetwork);

    return made.https ?? made.dusk;
  };

  $: ({ hideBalances, language } = $settingsStore);
  $: network = $nodeNetwork?.name ?? "";
  $: shown = $requestsStore.filter(
    ({ network: asked, to }) => asked === network && addresses.includes(to)
  );
  $: matches = matchRequests(shown, $activityState.rows);
  $: keepRequestMatches(matches);
  $: hasOpen = shown.some(({ id }) => matches.get(id)?.state !== "paid");
  $: lookWhile(hasOpen);
  // A payment may be further back than the history read so far.
  $: oldestRead = Math.min(
    ...$activityState.rows.map(({ time }) => time ?? Infinity)
  );
  $: isShort =
    $activityState.hasMore &&
    shown.some(
      ({ at, id }) => matches.get(id)?.state === "waiting" && at < oldestRead
    );
</script>

{#if shown.length}
  <section aria-labelledby="payment-requests" class="requests">
    <SectionHead id="payment-requests">Your requests</SectionHead>
    <ul class="requests__list">
      {#each shown as request (request.id)}
        {@const match = matches.get(request.id) ?? { state: "waiting" }}
        <li class="requests__item">
          <p class="requests__head">
            <strong>
              {#if request.lux === null}
                Any amount
              {:else}
                <BalanceValue
                  exact={formatDuskExact(BigInt(request.lux), language)}
                  value={formatDusk(BigInt(request.lux), language)}
                /> DUSK
              {/if}
            </strong>
            <span class="requests__state requests__state--{match.state}"
              >{STATE_WORDS[match.state]}</span
            >
          </p>
          {#if request.memo}
            <p class="requests__memo"><MemoText text={request.memo} /></p>
          {/if}
          <p class="requests__line">
            Asked {claimDay(request.at, language)}. {matchedText(
              match,
              language
            )}
          </p>
          <div class="requests__actions">
            {#if match.hash}
              <a
                class="text-link"
                href={addBasePath(`/dashboard/transactions?tx=${match.hash}`)}
                >See in History</a
              >
            {/if}
            <CopyButton
              name={`link of the request for ${amountOf(request)}${request.memo ? `, ${request.memo}` : ""}`}
              size="small"
              text="Copy link"
              value={linkOf(request)}
              variant="tertiary"
            />
            <Button
              aria-label={`Remove the request for ${amountOf(request)}${request.memo ? `, ${request.memo}` : ""}`}
              on:click={() => forgetRequest(request.id)}
              size="small"
              text="Remove"
              variant="tertiary"
            />
          </div>
        </li>
      {/each}
    </ul>
    {#if isShort}
      <p class="requests__line">
        A payment further back than your history shows so far won't show here.
      </p>
    {/if}
  </section>
{/if}

<style lang="postcss">
  .requests {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }

  .requests__list {
    display: flex;
    flex-direction: column;
    list-style: none;
  }

  .requests__item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--calm-line);
  }

  .requests__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.9375rem;

    & strong {
      font-weight: 500;
    }
  }

  .requests__state {
    flex-shrink: 0;
    color: var(--calm-muted);
    font-size: 0.8125rem;

    &--paid {
      color: var(--calm-online);
    }

    &--check {
      color: var(--calm-pending);
    }
  }

  .requests__memo {
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }

  .requests__line {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .requests__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding-top: 0.25rem;
    font-size: 0.875rem;
  }
</style>
