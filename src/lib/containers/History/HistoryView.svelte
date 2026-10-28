<script>
  import { contactNamesOf, contactsStore } from "$lib/contacts";
  import withdrawalClaims from "$lib/bridge/withdrawalClaims";
  import { sozuPools } from "$lib/sozu";
  import { createEventDispatcher } from "svelte";
  import { mdiTrayArrowDown } from "@mdi/js";
  import { Button, Icon, Select } from "$lib/dusk/components";
  import { BalanceValue } from "$lib/components";
  import {
    claimedWithdrawals,
    configuredBridgeContracts,
    describeRow,
    fullDateTime,
    groupByDay,
    isRowIncomplete,
    matchesFilters,
    rowTime,
    timeLabel,
    toCsv,
  } from "$lib/activity/present";

  import { ACTIVITY_ICONS } from "../Home/activityIcons";
  import TransactionDetail from "./TransactionDetail.svelte";

  /** @type {import("$lib/activity/activitySession").ActivityState} */
  export let state;

  /** @type {string} */
  export let locale;

  /** The network's name, for the export's file name and known contracts. */
  export let network = "";

  /** The account the history is of, and how the wallet names it. */
  /** @type {{ address: string, label: string } | null} */
  export let account = null;

  /** @type {string | null} */
  export let selected = null;

  /** @type {import("$lib/activity/present").ActivityKindFilter} */
  export let kind = "all";

  const dispatch = createEventDispatcher();

  /** @type {{ id: import("$lib/activity/present").ActivityKindFilter, label: string }[]} */
  const KINDS = [
    { id: "all", label: "All" },
    { id: "sent", label: "Sent" },
    { id: "received", label: "Received" },
    { id: "staking", label: "Staking" },
    { id: "bridge", label: "Bridge" },
  ];

  const PRIVACY = [
    { label: "Public and shielded", value: "all" },
    { label: "Public", value: "public" },
    { label: "Shielded", value: "shielded" },
  ];

  const RANGES = [
    { label: "All time", value: "all" },
    { label: "Last 7 days", value: "7" },
    { label: "Last 30 days", value: "30" },
    { label: "Last 90 days", value: "90" },
  ];

  /** @type {Record<string, string>} */
  const STATUS_WORDS = { pending: "Pending", unknown: "Not confirmed" };

  const bridgeContracts = configuredBridgeContracts();

  let privacy = "all";
  let range = "all";

  /** Whether an export holds the user's own contact names. */
  let withContacts = false;

  /** @param {ActivityRow} row */
  function select(row) {
    dispatch("select", row.hash === selected ? null : row.hash);
  }

  function exportCsv() {
    const csv = toCsv(
      shown.map(({ row }) => row),
      context,
      { withContacts }
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" })
    );
    const link = document.createElement("a");

    link.href = url;
    link.download = `dusk-history-${network || "wallet"}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // When the proved withdrawals can be claimed, as the chain says.
  $: void withdrawalClaims.load(state.rows);
  $: context = {
    bridgeContracts,
    claimed: claimedWithdrawals(state.rows),
    claims: $withdrawalClaims,
    contactNames: contactNamesOf($contactsStore),
    locale,
    network,
    sozuPools: $sozuPools,
  };
  $: since = range === "all" ? null : Date.now() - Number(range) * 86_400_000;
  $: described = state.rows.map((row) => ({
    presentation: describeRow(row, context),
    row,
  }));
  $: shown = described.filter(({ presentation, row }) =>
    matchesFilters(presentation, row, {
      kind,
      privacy:
        /** @type {import("$lib/activity/present").ActivityPrivacyFilter} */ (
          privacy
        ),
      since,
    })
  );
  $: groups = groupByDay(shown, ({ row }) => rowTime(row), {
    full: true,
    locale,
  });
  $: open = described.find(({ row }) => row.hash === selected) ?? null;
  $: incomplete = shown.filter(({ row }) => isRowIncomplete(row)).length;
  $: incompleteText = [
    state.error ? "Couldn't reach the network's history." : "",
    incomplete === 1
      ? 'A row has no date or fee yet. An export marks it "Not looked up yet".'
      : `${incomplete} rows have no date or fee yet. An export marks them "Not looked up yet".`,
  ]
    .filter(Boolean)
    .join(" ");

  /**
   * Closes the details, and gives the focus back to the row they were of.
   *
   * @param {string} hash
   */
  function closeDetail(hash) {
    dispatch("select", null);
    /** @type {HTMLElement | null} */ (
      document.querySelector(`.history__open[data-hash="${hash}"]`)
    )?.focus();
  }
</script>

<div class="history" class:history--open={open}>
  <section aria-labelledby="history-title" class="history__main">
    <header class="history__header">
      <h2 class="history__title" id="history-title">History</h2>
      <Button
        disabled={!shown.length}
        icon={{ path: mdiTrayArrowDown }}
        on:click={exportCsv}
        size="small"
        text="Export CSV"
        variant="secondary"
      />
    </header>
    <p class="history__note">
      Shown in your local time. An export holds the rows listed, with memos and
      .dusk names, and dates in UTC and local time.
    </p>
    <label class="history__option">
      <input bind:checked={withContacts} type="checkbox" />
      Include my contact names in the export, in their own column
    </label>
    {#if incomplete}
      <p class="history__incomplete" role="status">
        {incompleteText}
      </p>
    {/if}

    <div class="history__filters">
      <div aria-label="Show" class="history__kinds" role="group">
        {#each KINDS as option (option.id)}
          <button
            aria-pressed={kind === option.id}
            class="history__kind"
            class:history__kind--on={kind === option.id}
            on:click={() => {
              kind = option.id;
            }}
            type="button">{option.label}</button
          >
        {/each}
      </div>
      <Select
        aria-label="Public or shielded"
        bind:value={privacy}
        className="history__select"
        options={PRIVACY}
      />
      <Select
        aria-label="Dates"
        bind:value={range}
        className="history__select"
        options={RANGES}
      />
    </div>

    {#if !state.loaded}
      <p class="history__empty">Loading your history…</p>
    {:else if !state.rows.length}
      <p class="history__empty">
        {state.error
          ? "Couldn't reach the network's history."
          : state.syncing
            ? "Looking for your transactions…"
            : "No transactions yet."}
      </p>
    {:else if !shown.length}
      <p class="history__empty">Nothing for these filters.</p>
    {:else}
      <table class="history__table">
        <thead>
          <tr>
            <th class="ledger-label" scope="col">Transaction</th>
            <th class="history__col-type ledger-label" scope="col">Type</th>
            <th class="history__col-time ledger-label" scope="col">Time</th>
            <th class="history__col-amount ledger-label" scope="col">Amount</th>
          </tr>
        </thead>
        {#each groups as group (group.key)}
          <tbody>
            <tr class="history__day">
              <th colspan="4" scope="colgroup">{group.label}</th>
            </tr>
            {#each group.items as { presentation: p, row } (row.hash)}
              {@const time = rowTime(row)}
              <tr
                class="history__row"
                class:history__row--selected={row.hash === selected}
              >
                <td>
                  <button
                    aria-expanded={row.hash === selected}
                    aria-label={[
                      p.title,
                      p.line,
                      `${p.amount.sign}${p.amount.text} DUSK`,
                      time === null ? "" : fullDateTime(time, locale),
                      p.privacy,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    class="history__open"
                    data-hash={row.hash}
                    on:click={() => select(row)}
                    type="button"
                  >
                    <span aria-hidden="true" class="history__icon"
                      ><Icon path={ACTIVITY_ICONS[p.icon]} /></span
                    >
                    <span class="history__who">
                      <span
                        class="history__name"
                        class:history__code={p.titleIsAddress}>{p.title}</span
                      >
                      <span
                        class="history__line"
                        class:history__line--failed={p.status === "failed"}
                        >{#if p.note}<span class="history__wide">{p.line}</span
                          ><span class="history__narrow">{p.shortLine}</span
                          >{:else}{p.line}{/if}<span class="history__phone-meta"
                          >{time === null
                            ? ""
                            : ` · ${timeLabel(time, locale)}`}
                          · {p.privacy}</span
                        ></span
                      >
                      {#if p.note}
                        <span class="history__claim">{p.note}</span>
                      {/if}
                    </span>
                  </button>
                </td>
                <td class="history__col-type">{p.privacy}</td>
                <td
                  class="history__col-time"
                  title={time === null ? undefined : fullDateTime(time, locale)}
                  >{time === null ? "" : timeLabel(time, locale)}</td
                >
                <td class="history__col-amount">
                  <span
                    class="history__amount"
                    class:history__amount--muted={p.amount.muted}
                    >{p.amount.sign}<BalanceValue
                      exact={p.amount.exact}
                      value={p.amount.text}
                    />
                    <span class="history__unit">DUSK</span></span
                  >
                  {#if p.status && STATUS_WORDS[p.status]}
                    <span class="history__status history__status--{p.status}"
                      >{STATUS_WORDS[p.status]}</span
                    >
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        {/each}
      </table>
    {/if}

    {#if state.loaded && state.hasMore}
      <div class="history__more">
        <Button
          disabled={state.syncing}
          on:click={() => dispatch("more")}
          text={state.syncing ? "Loading…" : "Show more"}
          variant="secondary"
        />
      </div>
    {/if}
  </section>

  {#if open}
    <div class="history__detail">
      <TransactionDetail
        {account}
        {locale}
        {network}
        on:close={() => closeDetail(open?.row.hash ?? "")}
        presentation={open.presentation}
        row={open.row}
      />
    </div>
  {/if}
</div>

<style lang="postcss">
  .history {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    width: 100%;

    &--open {
      grid-template-columns: minmax(0, 1fr) 26rem;
    }
  }

  .history__main {
    min-width: 0;
    padding: 2.25rem 3rem 3rem;
  }

  .history__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .history__title {
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .history__note {
    margin-top: 0.375rem;
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .history__option {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    color: var(--calm-muted);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .history__incomplete {
    margin: 0 0 0.5rem;
    color: var(--calm-pending);
    font-size: 0.8125rem;
  }

  .history__filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 1.25rem 0 0.875rem;

    & :global(.history__select) {
      height: 2.25rem;
      border-radius: 0.625rem;
      background-color: var(--calm-s1);
      border: 0 none;
      color: var(--calm-text);
      font-size: 0.84375rem;
    }
  }

  .history__kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-right: 0.5rem;
  }

  .history__kind {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    height: 2rem;
    padding: 0 0.875rem;
    border: 1px solid var(--calm-line2);
    border-radius: 999px;
    color: var(--calm-muted);
    font-size: 0.84375rem;
    cursor: pointer;

    &--on {
      border-color: var(--calm-pill);
      background: var(--calm-pill);
      color: var(--calm-on-pill);
      font-weight: 500;
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }
  }

  .history__empty {
    margin: 2rem 0;
    color: var(--calm-muted);
  }

  .history__table {
    width: 100%;
    border-collapse: collapse;

    & thead th {
      padding: 0 1rem 0.625rem;
      border-bottom: 1px solid var(--calm-line2);
      color: var(--calm-subtle);
      text-align: left;
    }
  }

  .history__day th {
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--calm-line);
    background: var(--calm-s1);
    color: var(--calm-muted);
    font-size: 0.78125rem;
    font-weight: 400;
    text-align: left;
  }

  .history__row {
    border-bottom: 1px solid var(--calm-line);

    & td {
      padding: 0 1rem;
      font-size: 0.875rem;
    }

    /* The row's words take the room left, and are cut to fit it. */
    & td:first-child {
      width: 100%;
      max-width: 0;
    }

    &--selected {
      background: var(--calm-s2);
    }

    &:hover {
      background: var(--calm-s1);
    }
  }

  .history__open {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3.375rem;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: -2px;
      border-radius: 0.5rem;
    }
  }

  .history__icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--calm-s2);
    flex: 0 0 auto;

    & :global(.dusk-icon) {
      width: 0.9375rem;
      height: 0.9375rem;
    }
  }

  .history__who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .history__name {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history__code {
    font-family: var(--code-font-family);
    font-size: 0.8125rem;
    font-weight: 400;
  }

  .history__line {
    overflow: hidden;
    color: var(--calm-muted);
    font-size: 0.78125rem;
    text-overflow: ellipsis;
    white-space: nowrap;

    &--failed {
      color: var(--calm-danger);
    }
  }

  .history__col-type,
  .history__col-time {
    color: var(--calm-muted);
    white-space: nowrap;
  }

  .history__col-amount {
    text-align: right;
    white-space: nowrap;
  }

  .history__table thead .history__col-amount {
    text-align: right;
  }

  .history__amount {
    display: block;
    font-weight: 500;
    font-variant-numeric: tabular-nums;

    &--muted {
      color: var(--calm-subtle);
      font-weight: 400;
    }
  }

  .history__unit {
    color: var(--calm-muted);
    font-weight: 400;
  }

  .history__status {
    display: block;
    font-size: 0.78125rem;
    font-weight: 500;

    &--pending {
      color: var(--calm-pending);
    }

    &--unknown {
      color: var(--calm-muted);
    }
  }

  .history__more {
    display: flex;
    justify-content: center;
    margin-top: 1.5rem;
  }

  .history__detail {
    position: sticky;
    top: var(--header-height);
    align-self: start;
    height: calc(100vh - var(--header-height));
    overflow-y: auto;
    border-left: 1px solid var(--calm-line2);
    background: var(--calm-panel);
  }

  /* Phones only: the time and privacy after the line, a claim date under it. */
  .history__phone-meta,
  .history__narrow,
  .history__claim {
    display: none;
  }

  .history__claim {
    overflow: hidden;
    color: var(--calm-muted);
    font-size: 0.78125rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Narrow screens: the details over the list, as a page of their own. */
  @media (max-width: 63.99rem) {
    .history--open {
      grid-template-columns: minmax(0, 1fr);
    }

    .history__detail {
      position: fixed;
      inset: var(--header-height) 0 0;
      z-index: 11;
      max-height: none;
      border-left: 0 none;
      background: var(--calm-panel);
    }

    .history__main {
      padding: 1.75rem 1.5rem 2rem;
    }
  }

  @media (max-width: 47.99rem) {
    .history__main {
      padding: 1rem 1rem 1.5rem;
    }

    .history__col-type,
    .history__col-time {
      display: none;
    }

    .history__phone-meta,
    .history__narrow {
      display: inline;
    }

    /* A withdrawal's claim date on a line of its own: it doesn't fit after. */
    .history__wide {
      display: none;
    }

    .history__claim {
      display: block;
    }

    .history__row td,
    .history__day th,
    .history__table thead th {
      padding-left: 0.25rem;
      padding-right: 0.25rem;
    }

    .history__kind {
      height: 2.75rem;
    }
  }
</style>
