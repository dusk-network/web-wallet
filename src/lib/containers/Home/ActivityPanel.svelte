<script>
  import { contactNamesOf, contactsStore } from "$lib/contacts";
  import { mdiChevronRight } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import {
    configuredBridgeContracts,
    describeRow,
    groupByDay,
    matchesFilters,
    rowTime,
    zoneLabel,
  } from "$lib/activity/present";
  import { addBasePath } from "$lib/navigation";

  import ActivityRowItem from "./ActivityRowItem.svelte";

  /** @type {import("$lib/activity/activitySession").ActivityState} */
  export let state;

  /** @type {string} */
  export let locale;

  /** How many rows the panel shows at most. */
  export let limit = 8;

  /** @type {() => void} */
  export let onRetry = () => {};

  /** @type {{ id: import("$lib/activity/present").ActivityKindFilter, label: string }[]} */
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "sent", label: "Sent" },
    { id: "received", label: "Received" },
    { id: "staking", label: "Staking" },
  ];

  const bridgeContracts = configuredBridgeContracts();

  /** @type {import("$lib/activity/present").ActivityKindFilter} */
  let kind = "all";

  $: context = {
    bridgeContracts,
    contactNames: contactNamesOf($contactsStore),
    locale,
  };
  $: described = state.rows.map((row) => ({
    presentation: describeRow(row, context),
    row,
  }));
  $: shown = described
    .filter(({ presentation, row }) =>
      matchesFilters(presentation, row, { kind })
    )
    .slice(0, limit);
  $: groups = groupByDay(shown, ({ row }) => rowTime(row), { locale });
  $: zone = zoneLabel(Date.now(), locale);
</script>

<section aria-labelledby="activity-panel-title" class="activity-panel">
  <header class="activity-panel__header">
    <h2 id="activity-panel-title">Activity</h2>
    <a
      class="activity-panel__more"
      href={addBasePath("/dashboard/transactions")}
      >History <Icon path={mdiChevronRight} /></a
    >
  </header>

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

  <div aria-busy={!state.loaded || state.syncing} aria-live="polite">
    {#if !state.loaded}
      <p class="activity-panel__note">Loading your history…</p>
    {:else if !state.rows.length && state.error}
      <p class="activity-panel__note">Couldn't reach the network's history.</p>
      <Button on:click={onRetry} size="small" text="Try again" />
    {:else if !state.rows.length && state.syncing}
      <p class="activity-panel__note">Looking for your transactions…</p>
    {:else if !state.rows.length}
      <p class="activity-panel__note">No transactions yet.</p>
    {:else if !shown.length}
      <p class="activity-panel__note">Nothing here yet.</p>
    {:else}
      <p class="activity-panel__zone">Times in {zone}</p>
      {#each groups as group (group.key)}
        <h3 class="activity-panel__day">{group.label}</h3>
        {#each group.items as item (item.row.hash)}
          <ActivityRowItem
            {locale}
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

    & h2 {
      font-size: 1rem;
      font-weight: 500;
    }
  }

  .activity-panel__more {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    min-height: 44px;
    color: var(--calm-muted);
    font-size: 0.84375rem;
    text-decoration: none;

    & :global(.dusk-icon) {
      width: 0.9375rem;
      height: 0.9375rem;
    }

    &:hover {
      color: var(--calm-text);
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

  .activity-panel__zone {
    margin-top: 0.5rem;
    color: var(--calm-subtle);
    font-size: 0.75rem;
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

  @media (max-width: 47.99rem) {
    .activity-panel__filter {
      height: 2.75rem;
      padding: 0 1rem;
    }
  }
</style>
