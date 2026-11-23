<svelte:options immutable={true} />

<script>
  import { resolve } from "$app/paths";
  import { Icon } from "$lib/dusk/components";
  import { BalanceValue, MemoText } from "$lib/components";
  import { BALANCE_MASK } from "$lib/constants";
  import {
    fullDateTime,
    shortAddress,
    strangersMemo,
    timeLabel,
  } from "$lib/activity/present";

  import { ACTIVITY_ICONS } from "./activityIcons";

  /** @type {ActivityRow} */
  export let row;

  /** @type {import("$lib/activity/present").ActivityPresentation} */
  export let presentation;

  /** @type {string} */
  export let locale;

  /**
   * Whether the row is in a list about its counterparty, as a contact's:
   * it then says what happened, not who with.
   */
  export let withoutCounterparty = false;

  /**
   * Whom a memo that came in isn't a stranger's from, as History has it:
   * the profiles here and the contacts. Without it, no memo is marked.
   *
   * @type {Parameters<typeof strangersMemo>[1] | undefined}
   */
  export let memoAmong = undefined;

  /**
   * The addresses of the contacts whose names look like another's: a row
   * that names one says its address, as History does.
   *
   * @type {Set<string>}
   */
  export let alike = new Set();

  const SEPARATOR = " · ";

  /**
   * Said beside the amount: one not confirmed yet says so in its line, in
   * place of Sent.
   *
   * @type {Record<string, string>}
   */
  const STATUS_WORDS = { pending: "Pending" };

  $: p = presentation;
  $: time = row.time;
  $: failed = p.status === "failed";
  $: title = withoutCounterparty && !failed ? p.line : p.title;
  // Only a shielded row says which it is: public is the rule.
  $: shielded = p.privacy === "Shielded" ? p.privacy : "";
  $: details = failed
    ? [shielded]
    : [
        withoutCounterparty ? "" : p.shortLine,
        time === null ? "" : timeLabel(time, locale),
        shielded,
      ];
  // The look-alike contact it names, told apart by its address.
  $: alikeAt =
    !withoutCounterparty && p.counterparty && alike.has(p.counterparty)
      ? `${shortAddress(p.counterparty)} · name looks like another`
      : "";
  // A withdrawal's claim date, on a line of its own: it doesn't fit after.
  $: note = withoutCounterparty ? null : p.note;
  // A stranger's memo, marked as History marks it: who it's from, then
  // their words, in quotes.
  $: theirs = memoAmong && row.memo ? strangersMemo(row, memoAmong) : null;
</script>

<a
  class="activity-row"
  href={resolve(`/dashboard/transactions/?tx=${row.hash}`)}
>
  <span aria-hidden="true" class="activity-row__icon"
    ><Icon path={ACTIVITY_ICONS[p.icon]} /></span
  >
  <span class="activity-row__main">
    <span
      class="activity-row__title"
      class:activity-row__code={p.titleIsAddress && title === p.title}
      >{title}</span
    >
    {#if alikeAt}
      <span class="activity-row__alike">{alikeAt}</span>
    {/if}
    <span
      class="activity-row__line"
      title={time === null
        ? undefined
        : fullDateTime(time, locale, { seconds: true })}
      >{#if failed}<span class="activity-row__failed"
          >{#each p.line.split(BALANCE_MASK) as part, i (i)}{#if i}<BalanceValue
                hidden
                value=""
              />{/if}{part}{/each}</span
        >{#if details.some(Boolean)}{SEPARATOR}{/if}{/if}{details
        .filter(Boolean)
        .join(SEPARATOR)}</span
    >
    {#if note}
      <span class="activity-row__line">{note}</span>
    {/if}
    {#if theirs}
      <span class="activity-row__theirs"
        ><span class="activity-row__theirs-from">{theirs.from}</span><span
          class="activity-row__theirs-memo"
          >“<MemoText inline text={theirs.memo} />”</span
        ></span
      >
    {/if}
  </span>
  <span class="activity-row__right">
    <span
      class="activity-row__amount"
      class:activity-row__amount--muted={p.amount.muted}
      >{p.amount.sign}<BalanceValue
        exact={p.amount.exact}
        value={p.amount.text}
      />
      <span class="activity-row__unit">DUSK</span></span
    >
    {#if p.status && STATUS_WORDS[p.status]}
      <span class="activity-row__status activity-row__status--{p.status}"
        >{STATUS_WORDS[p.status]}</span
      >
    {/if}
  </span>
</a>

<style lang="postcss">
  .activity-row {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
    min-height: 3.5rem;
    padding: 0.625rem 0;
    border-bottom: 1px solid var(--calm-line);
    color: var(--calm-text);
    text-decoration: none;

    &:hover .activity-row__title {
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
      border-radius: 0.5rem;
    }
  }

  .activity-row__icon {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    background: var(--calm-s2);

    & :global(.dusk-icon) {
      width: 1.0625rem;
      height: 1.0625rem;
    }
  }

  .activity-row__main {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .activity-row__title {
    overflow: hidden;
    font-size: 0.875rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-row__code {
    font-family: var(--code-font-family);
    font-size: 0.8125rem;
    font-weight: 400;
  }

  /* What happened, its fee and its time, whole: the line wraps where it must. */
  .activity-row__line {
    color: var(--calm-muted);
    font-size: 0.78125rem;
    overflow-wrap: anywhere;
  }

  /* As History marks it: the warning and the address it names, whole. */
  .activity-row__alike {
    color: var(--calm-pending);
    font-size: 0.78125rem;
    overflow-wrap: anywhere;
  }

  .activity-row__failed {
    color: var(--calm-danger);
  }

  /* A stranger's memo: who it's from, then their words, muted. */
  .activity-row__theirs {
    display: flex;
    flex-direction: column;
    color: var(--calm-muted);
    font-size: 0.78125rem;
    overflow-wrap: anywhere;
  }

  /* Their words: two lines at most, its details have all of it; who it's
     from above them, which a long memo never cuts off. */
  .activity-row__theirs-memo {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .activity-row__right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.125rem;
  }

  .activity-row__amount {
    font-size: 0.875rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;

    &--muted {
      color: var(--calm-subtle);
      font-weight: 400;
    }
  }

  .activity-row__unit {
    color: var(--calm-muted);
    font-weight: 400;
  }

  .activity-row__status {
    font-size: 0.78125rem;
    font-weight: 500;

    &--pending {
      color: var(--calm-pending);
    }
  }
</style>
