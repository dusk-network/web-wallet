<svelte:options immutable={true} />

<script>
  /**
   * The requests this profile made, kept on this device, each marked by what
   * came in after it, in words that say what matched, and what a payment
   * that paid it brought. One paid already says so, with when, beside its
   * Copy request and Share, which ask on its card first: given out again,
   * its link would ask a second payment. Both give what it asks in a line,
   * then its link, as its own Copy request and Share did.
   */
  import { onDestroy } from "svelte";
  import { refundOf, sentAlready } from "@dusk-network/app-core/requests";
  import { displayText, numbersNote } from "@dusk-network/app-core/text";
  import { formatTime } from "@dusk-network/networks/format";

  import {
    arrivalsNotIn,
    awaitedArrivals,
    currentActivity,
    wholeActivity,
  } from "$lib/activity";
  import { resolve } from "$app/paths";
  import { LOOK_FOR_MS } from "$lib/activity/arrivals";
  import { paidInSentence } from "$lib/activity/present";
  import { claimDay } from "$lib/bridge/claimDate";
  import { Button, CopyButton } from "$lib/dusk/components";
  import { formatDusk, formatDuskExact } from "$lib/dusk/currency";
  import { goto } from "$lib/navigation";
  import {
    forgetRequest,
    keepRequestMatches,
    makeRequestLink,
    matchRequests,
    requestText,
    requestsStore,
  } from "$lib/payment-requests";
  import { settingsStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";

  import { BalanceValue, MemoText, SectionHead } from "..";

  import PaidAlready from "./PaidAlready.svelte";
  import { canShare, shareText } from "./share";

  /** The profile's public account and its shielded address. */
  /** @type {string[]} */
  export let addresses;

  /**
   * Whose requests they are, as Share says it: the profile's verified .dusk
   * name, else the name given it here, "" for none.
   */
  export let requestName = "";

  // Where a browser has a share sheet: most phones, some computers.
  const hasShare = canShare();

  /** @type {Record<string, string>} */
  const STATE_WORDS = { check: "Check", paid: "Paid", waiting: "Waiting" };

  /**
   * A line in parts: words, a memo someone else wrote, quoted as a memo
   * shows, nothing in it reordering or hiding the rest, and an amount that
   * came in, hidden with the balances.
   *
   * @typedef {{ text: string } | { memo: string } | { lux: bigint }} Part
   */

  /** How often the history is read again while this shows a request. */
  const LOOK_MS = 30_000;

  /**
   * How many payments of a request's amount with another memo its card
   * lists at most, while it isn't paid.
   */
  const SAME_AMOUNT_SHOWN = 3;

  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;

  /**
   * Reads the history for what's come in while requests show, paid or not:
   * one paid can be paid again. Nothing else does but a change of the
   * balance, which may have come before this shows, or before the payment's
   * block was final, and so before the history has it.
   *
   * @param {boolean} isShown
   */
  function lookWhile(isShown) {
    const look = () => {
      if (document.visibilityState !== "hidden") {
        void currentActivity()?.refresh();
      }
    };

    clearInterval(timer);
    timer = undefined;

    if (isShown) {
      look();
      timer = setInterval(look, LOOK_MS);
    }
  }

  /** When what's checked for is looked for no more: it's said again then. */
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let checkTimer;

  /** Bumped as a payment stops being looked for, to say so. */
  let checkedAt = 0;

  /**
   * Says what's checked for again once the first payment of it stops being
   * looked for.
   *
   * @param {import("$lib/activity/arrivals").AwaitedArrival[]} awaited
   */
  function checkUntil(awaited) {
    clearTimeout(checkTimer);

    if (awaited.length) {
      const first = Math.min(...awaited.map(({ at }) => at));

      checkTimer = setTimeout(
        () => {
          checkedAt = Date.now();
        },
        Math.max(0, first + LOOK_FOR_MS - Date.now()),
      );
    }
  }

  onDestroy(() => {
    clearInterval(timer);
    clearTimeout(checkTimer);
  });

  /**
   * What matched of a payment that matched only part of a request, in words:
   * "same amount on 5 Nov, 21:16:05 CET, with no memo".
   *
   * @param {{ at?: number, lux?: bigint, matched?: string, memo?: string }} payment
   * @param {string} language
   * @returns {Part[]}
   */
  function partOf({ at, lux, matched, memo }, language) {
    const day = at ? paidInSentence(at, language) : "";

    return matched === "amount"
      ? memo
        ? [
            { text: `same amount ${day}, with another memo: "` },
            { memo },
            { text: '"' },
          ]
        : [{ text: `same amount ${day}, with no memo` }]
      : [
          {
            text: hideBalances
              ? `same memo ${day}`
              : `same memo ${day}, for ${formatDuskExact(lux ?? 0n, language)} DUSK`,
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
   * The payments that match a request in part that could be its, as its
   * card lists them: those with its memo, of another amount, first; then
   * those of its amount with another memo, only while it isn't paid, and a
   * few at most, the first that came.
   *
   * @param {import("$lib/payment-requests/requests").RequestMatch} match
   */
  const couldBeIts = ({ more = [], state }) => [
    ...more.filter((payment) => payment.matched === "memo"),
    ...(state === "paid"
      ? []
      : more
          .filter((payment) => payment.matched === "amount")
          .slice(0, SAME_AMOUNT_SHOWN)),
  ];

  /**
   * What matched of a payment, in words, with what it brought where it paid
   * the request, and of the others that match the request in part and could
   * be its: another payment to check. A request paid more than once lists
   * its payments, and what each brought, under this.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   * @param {import("$lib/payment-requests/requests").RequestMatch} match
   * @param {string} language
   * @param {boolean} isChecking Whether a payment to it from another profile
   *   here went out, which the history doesn't have yet, or it's older than
   *   the history read so far while the rest of it is read
   * @returns {Part[]}
   */
  function matchedParts(request, match, language, isChecking) {
    const { at, lux, matched, memo } = match;
    const what =
      request.lux === null ? "Its memo matches" : "Amount and memo match";
    const day = at ? paidInSentence(at, language) : "";
    const again = paidAgain(match);
    const also = couldBeIts(match).flatMap((payment) => [
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
              ? [{ text: `${what} a payment${day ? ` ${day}` : ""}.` }]
              : [
                  { text: `${what} a payment of ` },
                  { lux },
                  { text: ` DUSK${day ? ` ${day}` : ""}.` },
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
        return [
          {
            text: isChecking ? "Checking for payments…" : "Not paid yet.",
          },
        ];
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
    "memo" in part && numbersNote(displayText(part.memo).flags) !== "";

  /**
   * Whether a refund was sent after the payment it would pay back came in:
   * by their blocks, as the chain has both, else by their blocks' times. One
   * in no block, sent from here, was while it's on its way, or went through
   * as the wallet saw: its time is this device's clock, which can be behind
   * the chain's, so it isn't set against the payment's. Not one whose
   * outcome isn't known: it may never have gone out.
   *
   * @param {ActivityRow} refund
   * @param {ActivityRow | undefined} payment
   */
  const isSentAfter = (refund, payment) =>
    typeof refund.blockHeight !== "number"
      ? refund.status === "pending" || refund.status === "executed"
      : typeof payment?.blockHeight === "number"
        ? refund.blockHeight > payment.blockHeight
        : (refund.time ?? 0) > (payment?.time ?? 0);

  /**
   * Send, filled in as a request's link asks: where a payment is sent back.
   *
   * @param {string} link
   * @returns {"/dashboard/send/" | `/dashboard/send/?${string}`}
   */
  function sendBackPath(link) {
    const { search } = new URL(link);

    return search ? `/dashboard/send/?${search.slice(1)}` : "/dashboard/send/";
  }

  /**
   * The payments that paid a request again, of all the requests shown, by
   * their hash: each with Send filled in to pay it back, as app-core's
   * `refundOf` says, and the refund sent already, as Send would say it's
   * sent again, sent after the payment came in. A refund is one payment's
   * only: one sent after two payments it could be for is the newer one's,
   * as one sent between them can only be the older one's. Send back is null
   * where whoever sent it isn't known, as for a shielded payment.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest[]} requests
   * @param {Map<string, import("$lib/payment-requests/requests").RequestMatch>} matched
   * @param {ActivityRow[]} rows
   * @param {Parameters<typeof makeRequestLink>[1]} net
   * @returns {Map<string, { back: ReturnType<typeof sendBackPath> | null, sent: ActivityRow | null }>}
   */
  function refundsOf(requests, matched, rows, net) {
    /** @type {string[]} */
    const taken = [];
    const owed = requests
      .flatMap((request) =>
        paidAgain(matched.get(request.id) ?? { state: "waiting" }).map(
          (payment) => ({ payment, request }),
        ),
      )
      .sort((x, y) => (y.payment.at ?? 0) - (x.payment.at ?? 0));

    return new Map(
      owed.map(({ payment, request }) => {
        const refund = refundOf(request, payment, rows);
        const paidIn = rows.find(({ hash }) => hash === payment.hash);
        const sent = refund
          ? sentAlready(
              rows.filter(
                (row) => !taken.includes(row.hash) && isSentAfter(row, paidIn),
              ),
              refund,
            )
          : null;
        const made = refund
          ? makeRequestLink(
              { amountLux: refund.lux, memo: refund.memo, to: refund.to },
              net,
            )
          : null;

        if (sent) {
          taken.push(sent.hash);
        }

        return [
          payment.hash,
          {
            back: made?.https ? sendBackPath(made.https) : null,
            sent,
          },
        ];
      }),
    );
  }

  /**
   * Opens Send filled in to pay a payment back: a link of its own, opened
   * elsewhere, shows what it asks too.
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
      goto(path, { state: { sendBack: true } });
    }
  }

  /**
   * When a payment of a request paid more than once was made, to the second:
   * two in the same minute, as a payment made twice often is, read apart.
   *
   * @param {number} ms
   */
  const paidAt = (ms) =>
    formatTime(ms, { locale: language || undefined, seconds: true });

  /**
   * When a request was asked, as a sentence says it: "today, 16:42 SGT", or
   * "on 5 Nov, …".
   *
   * @param {number} ms
   */
  function askedAt(ms) {
    const label = claimDay(ms, language);

    return /^(Today|Yesterday),/.test(label)
      ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
      : `on ${label}`;
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
   * @param {Parameters<typeof makeRequestLink>[1]} net
   */
  const linkOf = ({ lux, memo, to }, net) => {
    const made = makeRequestLink({ amountLux: lux, memo, to }, net);

    return made.https ?? made.dusk;
  };

  /**
   * What a request asks, in a line, then its link, as its own Share and
   * Copy request gave it, and as Share and Copy request give it here, with
   * whose it is as `said` says now (`saidBy`).
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   * @param {{ language: string, name: string, net: Parameters<typeof makeRequestLink>[1] }} said
   */
  const messageOf = (request, said) =>
    requestText(
      {
        link: linkOf(request, said.net),
        lux: request.lux === null ? null : BigInt(request.lux),
        memo: request.memo,
      },
      said,
    );

  /**
   * Shares a request again through the phone's share sheet: its message.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   */
  const share = (request) =>
    shareText({
      text: messageOf(request, saidBy),
      title: "Dusk payment request",
    });

  /**
   * What's asked on a card before its request, paid already, is given out
   * again: Copy or Share, on which card; null for nothing.
   *
   * @type {{ id: string, verb: "Copy" | "Share" } | null}
   */
  let asking = null;

  /**
   * Each card's Copy request, by its request's ID, to copy once asked.
   *
   * @type {Record<string, CopyButton>}
   */
  const copyButtons = {};

  /**
   * Whether a press on a card is held to ask first, as its request was paid
   * already (`paidOn`).
   *
   * @param {string} id
   * @param {"Copy" | "Share"} verb
   * @param {number | null} paidOn
   */
  function asksFirst(id, verb, paidOn) {
    asking = paidOn === null ? null : { id, verb };

    return asking !== null;
  }

  /**
   * Gives a request out all the same, as asked: copied, or shared.
   *
   * @param {import("$lib/payment-requests/requests").PaymentRequest} request
   */
  function giveAnyway(request) {
    const verb = asking?.verb;

    asking = null;

    if (verb === "Copy") {
      void copyButtons[request.id]?.copyNow();
    } else if (verb === "Share") {
      void share(request);
    }
  }

  /**
   * A paid request, in words beside its Copy and Share: "Paid today,
   * 16:42:05 SGT", or "Paid twice, first …".
   *
   * @param {number} again How many times it was paid again
   * @param {number} at When it was first paid
   */
  const paidWords = (again, at) =>
    `${
      again === 0
        ? "Paid"
        : again === 1
          ? "Paid twice, first"
          : `Paid ${again + 1} times, first`
    } ${paidInSentence(at, language)}`;

  $: ({ hideBalances, language } = $settingsStore);
  // Whose the requests are and how they're worded, as Copy request and
  // Share give them, anew as any of it changes: a Copy request drawn before
  // the profile's name was looked up gives it all the same, as Share does
  // (Sofía's: "You're asked to pay …" without her name, after an unlock).
  $: saidBy = { language, name: requestName, net: $nodeNetwork };
  $: network = $nodeNetwork?.name ?? "";
  $: shown = $requestsStore.filter(
    ({ network: asked, to }) => asked === network && addresses.includes(to),
  );
  // All of the history, not the page History has shown so far: a request
  // paid days ago is paid all the same.
  $: ({ rows: historyRows } = $wholeActivity);
  $: matches = matchRequests(shown, historyRows);
  $: refunds = refundsOf(shown, matches, historyRows, $nodeNetwork);
  $: keepRequestMatches(matches);
  // Looked for as one shows, and from then on, not again with each change.
  $: isShowing = shown.length > 0;
  $: lookWhile(isShowing);
  // A payment to this profile from another one here went out, and the
  // history doesn't have it yet: it's looked for, and checked, not nothing.
  $: awaited = arrivalsNotIn(
    $awaitedArrivals,
    addresses,
    historyRows,
    Math.max(Date.now(), checkedAt),
  );
  $: checkUntil(awaited);
  // A payment may be further back than the history read so far: checked
  // for while the rest is read, and said so where it couldn't be.
  $: oldestRead = historyRows.reduce(
    (oldest, { time }) => Math.min(oldest, time ?? Infinity),
    Infinity,
  );
  $: olderThanRead = new Set(
    shown
      .filter(
        ({ at, id }) => matches.get(id)?.state === "waiting" && at < oldestRead,
      )
      .map(({ id }) => id),
  );
  $: isShort = $wholeActivity.failed && olderThanRead.size > 0;
</script>

{#if shown.length}
  <section aria-labelledby="payment-requests" class="requests">
    <SectionHead id="payment-requests">Your requests</SectionHead>
    <ul class="requests__list">
      {#each shown as request (request.id)}
        {@const match = matches.get(request.id) ?? { state: "waiting" }}
        {@const again = paidAgain(match)}
        {@const paidOn =
          match.state === "paid" && match.at !== undefined ? match.at : null}
        {@const parts = matchedParts(
          request,
          match,
          language,
          awaited.some(({ to }) => to === request.to) ||
            ($wholeActivity.reading && olderThanRead.has(request.id)),
        )}
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
            {:else if match.state === "paid" && match.anyAmount}
              <!-- Asked no amount: what came in, however little, not a
                plain Paid. -->
              <span class="requests__state"
                >{#if match.lux === undefined}Paid{:else}<BalanceValue
                    value={formatDuskExact(match.lux, language)}
                  /> DUSK{/if}</span
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
            Asked {askedAt(request.at)}. {#each parts as part, i (i)}{#if "memo" in part}<MemoText
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
                  ? paidAt(payment.at)
                  : "time not known"}
                {@const refund = i ? refunds.get(String(payment.hash)) : null}
                <li class="requests__payment">
                  <span
                    >{day.charAt(0).toUpperCase()}{day.slice(
                      1,
                    )}{#if payment.lux !== undefined}, <BalanceValue
                        value={formatDuskExact(payment.lux, language)}
                      /> DUSK{/if}</span
                  >
                  <!-- Together, on the payment's line: never one alone. -->
                  <span class="requests__payment-links">
                    <a
                      aria-label={`See in Activity: the payment of ${day}`}
                      class="text-link tap-link"
                      href={resolve(
                        `/dashboard/transactions/?tx=${payment.hash}`,
                      )}>See in Activity</a
                    >
                    {#if refund?.back && !refund.sent}
                      {@const back = refund.back}
                      <a
                        aria-label={`Send back the payment of ${day}`}
                        class="text-link tap-link"
                        href={resolve(back)}
                        on:click={(event) => sendBack(event, back)}>Send back</a
                      >
                    {/if}
                  </span>
                  {#if refund?.sent}
                    {@const sent = refund.sent}
                    {@const sentAt =
                      sent.status === "executed" && sent.time
                        ? paidAt(sent.time)
                        : ""}
                    <!-- As the payments above it: its time first, once a
                      block has it, which is the one time it then has. -->
                    <span class="requests__sent-back"
                      >{#if sentAt}{sentAt
                          .charAt(0)
                          .toUpperCase()}{sentAt.slice(1)}, sent back{:else}Sent
                        back{/if}
                      <BalanceValue
                        value={formatDuskExact(sent.value, language)}
                      /> DUSK{sentAt ? "" : ", on its way"} ·
                      <a
                        aria-label={`See in Activity: what was sent back for the payment of ${day}`}
                        class="text-link tap-link"
                        href={resolve(
                          `/dashboard/transactions/?tx=${sent.hash}`,
                        )}>See in Activity</a
                      ></span
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
                href={resolve(`/dashboard/transactions/?tx=${match.hash}`)}
                >See in Activity</a
              >
            {/if}
            <!-- Paid already: said beside its Copy and Share. -->
            {#if paidOn !== null}
              <span class="requests__paid"
                >{paidWords(again.length, paidOn)}</span
              >
            {/if}
            <CopyButton
              bind:this={copyButtons[request.id]}
              hold={() => asksFirst(request.id, "Copy", paidOn)}
              name={`request for ${amountOf(request)}${request.memo ? `, ${request.memo}` : ""}`}
              size="small"
              text="Copy request"
              value={messageOf(request, saidBy)}
              variant="tertiary"
            />
            {#if hasShare}
              <Button
                aria-label={`Share the request for ${amountOf(request)}${request.memo ? `, ${request.memo}` : ""}`}
                on:click={() => {
                  if (!asksFirst(request.id, "Share", paidOn)) {
                    void share(request);
                  }
                }}
                size="small"
                text="Share"
                variant="tertiary"
              />
            {/if}
            <Button
              aria-label={`Remove the request for ${amountOf(request)}${request.memo ? `, ${request.memo}` : ""}`}
              on:click={() => forgetRequest(request.id)}
              size="small"
              text="Remove"
              variant="tertiary"
            />
          </div>
          <!-- Asked on the card itself, never only said after. -->
          {#if asking?.id === request.id && paidOn !== null}
            <PaidAlready
              at={paidOn}
              onAnyway={() => giveAnyway(request)}
              onCancel={() => {
                asking = null;
              }}
              verb={asking.verb}
            />
          {/if}
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

  .requests__payment-links {
    display: inline-flex;
    flex-wrap: nowrap;
    gap: 0.75rem;
  }

  .requests__sent-back {
    flex-basis: 100%;
  }

  .requests__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding-top: 0.25rem;
    font-size: 0.875rem;
  }

  .requests__paid {
    color: var(--calm-online);
    font-size: 0.8125rem;
  }
</style>
