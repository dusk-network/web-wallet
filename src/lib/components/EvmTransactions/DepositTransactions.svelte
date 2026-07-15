<script>
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import {
    mdiArrowLeft,
    mdiContain,
    mdiRefresh,
    mdiWalletOutline,
  } from "@mdi/js";

  import {
    depositActivityStore,
    hydrateDepositActivity,
    refreshDepositTransaction,
    resumeDepositTracking,
  } from "$lib/bridge/depositActivity";
  import {
    depositStageBadge,
    depositStageLabel,
    isDepositTerminal,
  } from "$lib/bridge/depositLifecycle";
  import { AppAnchorButton, Banner } from "$lib/components";
  import { Badge, Button, Icon, Throbber } from "$lib/dusk/components";
  import { account, modal } from "$lib/web3/walletConnection";

  import DepositLifecycle from "./DepositLifecycle.svelte";
  import {
    activityAmount,
    formatTimestamp,
    shortened,
  } from "./withdrawalPresentation";

  const POLL_INTERVAL_MS = 30_000;

  /** @type {any[]} */
  let allActivity = [];

  /** @type {any[]} */
  let activity = [];

  /** @type {any} */
  let selectedDeposit = null;

  /** @type {string | null} */
  let currentAccount = null;

  /** @type {Date | null} */
  let lastCheckedAt = null;

  /** @type {boolean} */
  let isChecking = false;

  /** @type {HTMLElement | null} */
  let statusPaneElement = null;

  function filterActivity() {
    activity = allActivity
      .filter(
        (item) =>
          item.account === null ||
          (currentAccount !== null && item.account === currentAccount)
      )
      .sort((left, right) => right.createdAt - left.createdAt);

    if (selectedDeposit) {
      selectedDeposit =
        activity.find(
          (item) => item.transactionHash === selectedDeposit.transactionHash
        ) ?? null;
    }

    const queryHash = $page.url.searchParams.get("tx")?.toLowerCase();

    if (!selectedDeposit && queryHash) {
      selectedDeposit =
        activity.find((item) => item.transactionHash === queryHash) ?? null;
    }
  }

  /** @param {any} item */
  function selectDeposit(item) {
    selectedDeposit = item;

    if (!window.matchMedia("(max-width: 48rem)").matches) return;

    window.requestAnimationFrame(() => {
      statusPaneElement?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }

  async function refresh() {
    if (isChecking) return;

    isChecking = true;
    const pending = activity.filter((item) => !isDepositTerminal(item));
    const targets =
      pending.length > 0 ? pending : selectedDeposit ? [selectedDeposit] : [];

    try {
      await Promise.all(
        targets.map((item) => refreshDepositTransaction(item.transactionHash))
      );
      lastCheckedAt = new Date();
    } finally {
      isChecking = false;
    }
  }

  onMount(() => {
    const unsubscribeAccount = account.subscribe((value) => {
      currentAccount = value.address?.toLowerCase() ?? null;
      filterActivity();

      if (currentAccount) {
        resumeDepositTracking(currentAccount);
      }
    });
    const unsubscribeActivity = depositActivityStore.subscribe((items) => {
      allActivity = items;
      filterActivity();
    });

    allActivity = hydrateDepositActivity();
    filterActivity();

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubscribeAccount();
      unsubscribeActivity();
      window.clearInterval(timer);
    };
  });
</script>

<article in:fade|global class="transactions">
  <header class="transactions__header">
    <div>
      <h3 class="h4">Deposit activity</h3>
      {#if currentAccount}
        <p>{shortened(currentAccount)}</p>
      {/if}
    </div>
    <div class="transactions__header-actions">
      <Button
        aria-label="Refresh deposit activity"
        data-tooltip-id="main-tooltip"
        data-tooltip-text="Refresh activity"
        disabled={isChecking}
        icon={{ path: mdiRefresh }}
        on:click={refresh}
        variant="tertiary"
      />
      <AppAnchorButton
        href="/dashboard/bridge"
        text="Back"
        variant="tertiary"
        icon={{ path: mdiArrowLeft }}
      />
    </div>
  </header>

  <div class="transactions__body">
    <section class="activity-pane" aria-labelledby="recent-deposits-title">
      <header class="pane-header">
        <div>
          <h4 id="recent-deposits-title">Recent deposits</h4>
          {#if lastCheckedAt}
            <p>Updated {formatTimestamp(lastCheckedAt.toISOString())}</p>
          {/if}
        </div>
      </header>

      {#if !currentAccount}
        <Banner title="Connect DuskEVM wallet" variant="info">
          <div class="connect-wallet">
            <p>Connect the destination account to view its deposits.</p>
            <Button
              icon={{ path: mdiWalletOutline }}
              text="Connect"
              on:click={() => modal.open()}
            />
          </div>
        </Banner>
      {/if}

      {#if isChecking && activity.length === 0}
        <div class="transactions-list__empty" aria-live="polite">
          <Throbber />
          <p>Loading activity</p>
        </div>
      {:else if activity.length > 0}
        <ul class="activity-list">
          {#each activity as item (item.transactionHash)}
            <li>
              <button
                aria-pressed={selectedDeposit?.transactionHash ===
                  item.transactionHash}
                class:activity-list__item--selected={selectedDeposit?.transactionHash ===
                  item.transactionHash}
                class="activity-list__item"
                on:click={() => selectDeposit(item)}
                type="button"
              >
                <span class="activity-list__primary">
                  <strong>{activityAmount(item) ?? "DUSK deposit"}</strong>
                  <span
                    >{formatTimestamp(
                      new Date(item.createdAt).toISOString()
                    )}</span
                  >
                </span>
                <span class="activity-list__status">
                  <Badge
                    text={depositStageLabel(item)}
                    variant={depositStageBadge(item)}
                  />
                  <span>{shortened(item.transactionHash)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="transactions-list__empty">
          <Icon path={mdiContain} size="large" />
          <p>No deposits found</p>
        </div>
      {/if}
    </section>

    <section class="status-pane" bind:this={statusPaneElement}>
      {#if selectedDeposit}
        <DepositLifecycle
          deposit={selectedDeposit}
          {isChecking}
          on:refresh={refresh}
        />
      {:else}
        <div class="transactions-list__empty status-pane__empty">
          <Icon path={mdiContain} size="large" />
          <p>Select a deposit to view its progress</p>
        </div>
      {/if}
    </section>
  </div>
</article>

<style lang="postcss">
  .transactions {
    background: var(--surface-color);
    border-radius: 1.25em;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    &__header {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: space-between;
      padding: 1.25rem;

      & h3,
      & p {
        margin: 0;
      }

      & p {
        color: var(--secondary-text-color);
        font-family: var(--mono-font-family);
        font-size: 0.8125rem;
        margin-top: 0.25rem;
      }
    }

    &__header-actions {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    &__body {
      border-top: 1px solid var(--surface-border-color-subtle);
      display: grid;
      grid-template-columns: minmax(17rem, 0.85fr) minmax(0, 1.35fr);
      min-height: 32rem;
    }
  }

  .activity-pane,
  .status-pane {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    padding: 1.25rem;
  }

  .activity-pane {
    border-right: 1px solid var(--surface-border-color-subtle);
  }

  .pane-header {
    & h4,
    & p {
      margin: 0;
    }

    & p {
      color: var(--secondary-text-color);
      font-size: 0.8125rem;
      margin-top: 0.25rem;
    }
  }

  .connect-wallet {
    align-items: flex-start;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    & p {
      margin: 0;
    }
  }

  .activity-list {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;

    & li + li {
      border-top: 1px solid var(--surface-border-color-subtle);
    }

    &__item {
      align-items: center;
      background: transparent;
      border: 0;
      color: inherit;
      cursor: pointer;
      display: grid;
      font: inherit;
      gap: 0.75rem;
      grid-template-columns: minmax(0, 1fr) auto;
      min-height: 5.25rem;
      padding: 0.875rem 0.5rem;
      text-align: left;
      width: 100%;

      &:hover,
      &:focus-visible,
      &--selected {
        background: var(--surface-hover-color);
        outline: none;
      }

      &:focus-visible {
        box-shadow: inset 0 0 0 2px var(--secondary-color);
      }
    }

    &__primary,
    &__status {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      min-width: 0;
    }

    &__primary span,
    &__status > span:last-child {
      color: var(--secondary-text-color);
      font-size: 0.75rem;
    }

    &__status {
      align-items: flex-end;
      font-family: var(--mono-font-family);
      text-align: right;
    }
  }

  .transactions-list__empty {
    align-items: center;
    color: var(--secondary-text-color);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 3rem 1.5rem;
    text-align: center;
  }

  .status-pane__empty {
    margin: auto;
  }

  @media (max-width: 48rem) {
    .transactions__body {
      grid-template-columns: minmax(0, 1fr);
    }

    .activity-pane {
      border-bottom: 1px solid var(--surface-border-color-subtle);
      border-right: 0;
    }
  }

  @media (max-width: 30rem) {
    .activity-pane,
    .status-pane {
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .activity-list__item {
      grid-template-columns: minmax(0, 1fr);
    }

    .activity-list__status {
      align-items: flex-start;
      text-align: left;
    }
  }
</style>
