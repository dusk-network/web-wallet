<svelte:options immutable={true} />

<script>
  /**
   * The requests this profile made, kept on this device, each marked by what
   * came in after it, in words that say what matched, and what a payment
   * that paid it brought.
   */
  import { onDestroy } from "svelte";
  import { refundOf, sentAlready } from "@dusk-network/app-core/requests";
  import { displayText } from "@dusk-network/app-core/text";

  import { activityState, currentActivity } from "$lib/activity";
  import { claimDay } from "$lib/bridge/claimDate";
  import { Button, CopyButton } from "$lib/dusk/components";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import { addBasePath, goto } from "$lib/navigation";
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

  /**
   * A line in parts: words, a memo someone else wrote, quoted as a memo
   * shows, nothing in it reordering or hiding the rest, and an amount that
   * came in, hidden with the balances.
   *
   * @typedef {{ text: string } | { memo: string } | { lux: bigint }} Part
   */

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
   * @returns {Part[]}
   */
  function partOf({ at, lux, matched, memo }, language) {
    const day = at ? claimDay(at, language) : "";

    return matched === "amount"
      ? memo
        ? [
            { text: `same amount on ${day}, with another memo: "` },
            { memo },
            { text: '"' },
          ]
        : [{ text: `same amount on ${day}, with no memo` }]
      : [
          {
            text: hideBalances
              ? `same memo on ${day}`
              : `same memo on ${day}, for ${formatDuskExact(lux ?? 0n, language)} DUSK`,
          },
        ];
  }

  /**
   * The payments that had all a request asks again, after the one that
   * paid it: it was paid twice, or more.
   *
   * @param {import("$lib/payment-requests/requests").RequestMatch} match
   */
  const paidAgain = ({ more = [], state }) =>
    state === "paid"
      ? more.filter((payment) => payment.matched === "amount-memo")
      : [];

  /**
   * What matched of a payment, in words, with what it brought where it paid
   * the request, and of the others that match the request in part: another
   * payment to check. A request paid more than once lists its payments, and
   * what each brought, under this.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   * @param {import("$lib/payment-requests/requests").RequestMatch} match
   * @param {string} language
   * @returns {Part[]}
   */
  function matchedParts(request, match, language) {
    const { at, lux, matched, memo, more = [] } = match;
    const what =
      request.lux === null ? "Its memo matches" : "Amount and memo match";
    const day = at ? claimDay(at, language) : "";
    const again = paidAgain(match);
    const also = more
      .filter((payment) => payment.matched !== "amount-memo")
      .flatMap((payment) => [
        { text: " Also the " },
        ...partOf(payment, language),
        { text: "." },
      ]);

    switch (matched) {
      case "amount-memo":
        return [
          ...(again.length
            ? [{ text: `${what} ${again.length + 1} payments.` }]
            : lux === undefined
              ? [{ text: `${what} a payment${day ? ` on ${day}` : ""}.` }]
              : [
                  { text: `${what} a payment of ` },
                  { lux },
                  { text: ` DUSK${day ? ` on ${day}` : ""}.` },
                ]),
          ...also,
        ];
      case "amount":
      case "memo": {
        const [first, ...rest] = partOf({ at, lux, matched, memo }, language);
        const opening = "text" in first ? first.text : "";

        return [
          {
            text: `${opening.charAt(0).toUpperCase()}${opening.slice(1)}`,
          },
          ...rest,
          { text: ". Check it's this one." },
          ...also,
        ];
      }
      default:
        return [{ text: "Nothing matching has come in." }];
    }
  }

  /**
   * Whether a part quotes a memo with something hidden in it.
   *
   * @param {Part} part
   */
  const hidesSomething = (part) =>
    "memo" in part && displayText(part.memo).neutralized;

  /**
   * Whether a part quotes a memo with a number that can read as another: of
   * digits that read right to left, or of more than one kind.
   *
   * @param {Part} part
   */
  const misreads = (part) =>
    "memo" in part &&
    displayText(part.memo).flags.some(
      (flag) => flag === "mixed_digits" || flag === "rtl_digits"
    );

  /**
   * The payments that paid a request again, each with Send filled in to pay
   * it back, as app-core's `refundOf` says, and the refund sent already, as
   * Send would say it's sent again: one each, oldest first. Send back is
   * null where whoever sent it isn't known, as for a shielded payment.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   * @param {import("$lib/payment-requests/requests").RequestPayment[]} again
   * @param {ActivityRow[]} rows
   * @returns {Map<string, { back: string | null, sent: ActivityRow | null }>}
   */
  function refundsOf(request, again, rows) {
    /** @type {string[]} */
    const taken = [];

    return new Map(
      again.map((payment) => {
        const refund = refundOf(request, payment, rows);
        const sent = refund
          ? sentAlready(
              rows.filter(({ hash }) => !taken.includes(hash)),
              refund
            )
          : null;
        const made = refund
          ? makeRequestLink(
              { amountLux: refund.lux, memo: refund.memo, to: refund.to },
              $nodeNetwork
            )
          : null;

        if (sent) {
          taken.push(sent.hash);
        }

        return [
          payment.hash,
          {
            back: made?.https
              ? `/dashboard/send${new URL(made.https).search}`
              : null,
            sent,
          },
        ];
      })
    );
  }

  /**
   * Opens Send filled in to pay a payment back, its amount hidden with the
   * balances, as what came in is: a link of its own, opened elsewhere, shows
   * what it asks.
   *
   * @param {MouseEvent} event
   * @param {string} path Send's, with what it's filled in with
   */
  function sendBack(event, path) {
    if (
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      goto(path, { state: { amountHidden: true } });
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
        {@const again = paidAgain(match)}
        {@const parts = matchedParts(request, match, language)}
        {@const refunds = refundsOf(request, again, $activityState.rows)}
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
            {#if again.length}
              <span class="requests__state requests__state--again"
                >{again.length === 1
                  ? "Paid twice"
                  : `Paid ${again.length + 1} times`}</span
              >
            {:else}
              <span class="requests__state requests__state--{match.state}"
                >{STATE_WORDS[match.state]}</span
              >
            {/if}
          </p>
          {#if request.memo}
            <p class="requests__memo"><MemoText text={request.memo} /></p>
          {/if}
          <p class="requests__line">
            Asked {claimDay(request.at, language)}. {#each parts as part, i (i)}{#if "memo" in part}<MemoText
                  inline
                  text={part.memo}
                />{:else if "lux" in part}<BalanceValue
                  value={formatDuskExact(part.lux, language)}
                />{:else}{part.text}{/if}{/each}
          </p>
          {#if parts.some(hidesSomething)}
            <p class="requests__hidden">
              A memo here has hidden characters, shown as codes.
            </p>
          {/if}
          {#if parts.some(misreads)}
            <p class="requests__hidden">
              A number in a memo here may not be what it looks like.
            </p>
          {/if}
          {#if again.length}
            <!-- Each payment, to see, and the ones after the first to pay back. -->
            <ul
              aria-label="Payments for this request"
              class="requests__payments"
            >
              {#each [match, ...again] as payment, i (payment.hash)}
                {@const day = payment.at
                  ? claimDay(payment.at, language)
                  : "time not known"}
                {@const refund = i ? refunds.get(String(payment.hash)) : null}
                <li class="requests__payment">
                  <span
                    >{day.charAt(0).toUpperCase()}{day.slice(
                      1
                    )}{#if payment.lux !== undefined}, <BalanceValue
                        value={formatDuskExact(payment.lux, language)}
                      /> DUSK{/if}</span
                  >
                  <a
                    aria-label={`See in History: the payment of ${day}`}
                    class="text-link tap-link"
                    href={addBasePath(
                      `/dashboard/transactions?tx=${payment.hash}`
                    )}>See in History</a
                  >
                  {#if refund?.sent}
                    <span
                      >Sent back{refund.sent.time
                        ? ` on ${claimDay(refund.sent.time, language)}`
                        : ""}</span
                    >
                  {:else if refund?.back}
                    {@const back = refund.back}
                    <a
                      aria-label={`Send back the payment of ${day}`}
                      class="text-link tap-link"
                      href={addBasePath(back)}
                      on:click={(event) => sendBack(event, back)}>Send back</a
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          <div class="requests__actions">
            {#if match.hash && !again.length}
              <a
                class="text-link tap-link"
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

    &--check,
    &--again {
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

  .requests__hidden {
    color: var(--calm-danger);
    font-size: 0.8125rem;
  }

  .requests__payments {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.875rem;
  }

  .requests__payment {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;

    & span {
      color: var(--calm-muted);
      font-variant-numeric: tabular-nums;
    }
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
