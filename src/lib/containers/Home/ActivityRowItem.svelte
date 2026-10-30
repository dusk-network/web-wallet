<svelte:options immutable={true} />

<script>
  import { Icon } from "$lib/dusk/components";
  import { BalanceValue } from "$lib/components";
  import { fullDateTime, timeLabel } from "$lib/activity/present";
  import { addBasePath } from "$lib/navigation";

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

  const SEPARATOR = " · ";

  /** @type {Record<string, string>} */
  const STATUS_WORDS = {
    pending: "Pending",
    unknown: "Not confirmed",
  };

  $: p = presentation;
  $: time = row.time;
  $: failed = p.status === "failed";
  $: title = withoutCounterparty && !failed ? p.line : p.title;
  $: details = failed
    ? [p.privacy]
    : [
        withoutCounterparty ? "" : p.shortLine,
        time === null ? "" : timeLabel(time, locale),
        p.privacy,
      ];
  // A withdrawal's claim date, on a line of its own: it doesn't fit after.
  $: note = withoutCounterparty ? null : p.note;
</script>

<a
  class="activity-row"
  href={addBasePath(`/dashboard/transactions?tx=${row.hash}`)}
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
    <span
      class="activity-row__line"
      title={time === null ? undefined : fullDateTime(time, locale)}
      >{#if failed}<span class="activity-row__failed">{p.line}</span
        >{SEPARATOR}{/if}{details.filter(Boolean).join(SEPARATOR)}</span
    >
    {#if note}
      <span class="activity-row__line">{note}</span>
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

  .activity-row__line {
    overflow: hidden;
    color: var(--calm-muted);
    font-size: 0.78125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-row__failed {
    color: var(--calm-danger);
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

    &--unknown {
      color: var(--calm-muted);
    }
  }
</style>
