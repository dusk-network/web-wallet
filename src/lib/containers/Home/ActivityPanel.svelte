<script>
  import { resolve } from "$app/paths";
  import { contactNamesOf, contactsStore } from "$lib/contacts";
  import withdrawalClaims from "$lib/bridge/withdrawalClaims";
  import { mdiChevronRight } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import { SectionHead } from "$lib/components";
  import { describeRow, groupByDay, isOfKind } from "$lib/activity/present";
  import { walletStore } from "$lib/stores";
  import { sentAfterDontSend } from "$lib/transactions/sentAfterDontSend";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import walletAccountNames, { profilesHere } from "$lib/wallets/accountNames";

  import ActivityRowItem from "./ActivityRowItem.svelte";

  /** @type {import("$lib/activity/activitySession").ActivityState} */
  export let state;

  /** @type {string} */
  export let locale;

  /** How many rows the panel shows at most. */
  export let limit = 8;

  /** @type {() => void} */
  export let onRetry = () => {};

  /** The panel's heading. */
  export let title = "Activity";

  /**
   * The only rows the panel shows, of one kind and without the filters; or
   * null for all, with them.
   *
   * @type {import("$lib/activity/present").ActivityKindFilter | null}
   */
  export let only = null;

  /** What the panel says without a row to show. */
  export let emptyText = "Nothing here yet.";

  /**
   * All of the history, which the rows of one kind are found in, not only
   * the page History has shown so far: null to find them there.
   *
   * @type {import("$lib/activity").WholeActivity | null}
   */
  export let whole = null;

  /** @type {{ id: import("$lib/activity/present").ActivityKindFilter, label: string }[]} */
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "sent", label: "Sent" },
    { id: "received", label: "Received" },
    { id: "staking", label: "Staking" },
  ];

  /** @type {import("$lib/activity/present").ActivityKindFilter} */
  let kind = "all";

  // When the proved withdrawals can be claimed, as the chain says.
  $: void withdrawalClaims.load(state.rows);
  $: context = {
    claims: $withdrawalClaims,
    contactNames: contactNamesOf($contactsStore),
    // What went out after Don't send, until it's opened.
    declined: $sentAfterDontSend,
    locale,
    net: $nodeNetwork,
    walletNames: $walletAccountNames,
  };
  // Whom a memo that came in isn't a stranger's from, as History has it:
  // the profiles here, every wallet's, and the contacts.
  $: memoAmong = {
    contacts: $contactsStore,
    profiles: [
      ...$profilesHere.map(({ address }) => ({ account: address })),
      { address: String($walletStore.currentProfile?.address ?? "") },
    ],
  };
  $: shownKind = only ?? kind;
  // The newest of a kind, from all of the history: a stake further back
  // than the page History has shown is staking all the same. While what
  // this device doesn't keep is read, or where it couldn't be, that none
  // is found yet says nothing.
  $: isFound = shownKind !== "all" && whole !== null;
  $: rows = isFound && whole ? whole.rows : state.rows;
  $: isLooking = state.syncing || Boolean(isFound && whole?.reading);
  $: isUnread = Boolean(state.error || (isFound && whole?.failed));
  $: shown = rows
    .filter((row) => isOfKind(row, shownKind))
    .slice(0, limit)
    .map((row) => ({ presentation: describeRow(row, context), row }));
  $: groups = groupByDay(shown, ({ row }) => row.time, { locale });
</script>

<section aria-labelledby="activity-panel-title" class="activity-panel">
  <header class="activity-panel__header">
    <SectionHead id="activity-panel-title">{title}</SectionHead>
    <a
      class="activity-panel__more text-link"
      href={resolve(
        only
          ? `/dashboard/transactions/?kind=${only}`
          : "/dashboard/transactions/",
      )}>See all <Icon path={mdiChevronRight} /></a
    >
  </header>

  {#if !only}
    <div aria-label="Show" class="activity-panel__filters" role="group">
      {#each FILTERS as filter (filter.id)}
        <button
          aria-pressed={kind === filter.id}
          class="activity-panel__filter"
          class:activity-panel__filter--on={kind === filter.id}
          on:click={() => {
            kind = filter.id;
          }}
          type="button">{filter.label}</button
        >
      {/each}
    </div>
  {/if}

  <div aria-busy={!state.loaded || isLooking} aria-live="polite">
    {#if !state.loaded}
      <p class="activity-panel__note">Loading your history…</p>
    {:else if !rows.length && isUnread}
      <!-- None among the rows it shows, as all of the history for a kind:
        none yet says nothing while they're read, or where they couldn't be. -->
      <p class="activity-panel__note">Couldn't reach the network's history.</p>
      <Button on:click={onRetry} size="small" text="Try again" />
    {:else if !rows.length && isLooking}
      <p class="activity-panel__note">Looking for your transactions…</p>
    {:else if !rows.length}
      <p class="activity-panel__note">No transactions yet.</p>
    {:else if !shown.length && isLooking}
      <p class="activity-panel__note">Looking for your transactions…</p>
    {:else if !shown.length && isUnread}
      <p class="activity-panel__note">Couldn't reach the network's history.</p>
      <Button on:click={onRetry} size="small" text="Try again" />
    {:else if !shown.length}
      <p class="activity-panel__note">{emptyText}</p>
    {:else}
      {#each groups as group (group.key)}
        <h3 class="activity-panel__day">{group.label}</h3>
        {#each group.items as item (item.row.hash)}
          <ActivityRowItem
            {locale}
            {memoAmong}
            presentation={item.presentation}
            row={item.row}
          />
        {/each}
      {/each}
      {#if state.error}
        <p class="activity-panel__note">
          Couldn't reach the network's history: this may not show the latest.
        </p>
      {/if}
    {/if}
  </div>
</section>

<style lang="postcss">
  .activity-panel__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .activity-panel__more {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    min-height: 44px;
    font-size: 0.84375rem;
    text-decoration: none;

    & :global(.dusk-icon) {
      width: 0.9375rem;
      height: 0.9375rem;
    }
  }

  .activity-panel__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0.25rem 0 0.375rem;
  }

  .activity-panel__filter {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    height: 1.875rem;
    padding: 0 0.75rem;
    border: 1px solid var(--calm-line2);
    border-radius: 999px;
    color: var(--calm-muted);
    font-size: 0.8125rem;
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

  .activity-panel__day {
    margin: 1.125rem 0 0.125rem;
    color: var(--calm-subtle);
    font-size: 0.78125rem;
    font-weight: 400;
  }

  .activity-panel__note {
    margin: 0.75rem 0;
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  @media (max-width: 47.99rem), (pointer: coarse) {
    .activity-panel__filter {
      height: 2.75rem;
      padding: 0 1rem;
    }
  }
</style>
