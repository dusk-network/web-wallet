<script>
  import { onDestroy } from "svelte";
  import { pushState } from "$app/navigation";
  import { page } from "$app/stores";
  import { mdiChevronDown } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import { SyncBar } from "$lib/components";
  import { handlePageClick } from "$lib/dusk/ui-helpers/handlePageClick";
  import { networkStore, walletStore } from "$lib/stores";

  import { networkLabel } from "./navigation";

  let open = false;

  /** Whether the browser says it's offline: said at once, before a sync fails. */
  let isOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;

  /**
   * How long a sync waits with nothing back from the network before it's
   * said not to be reached: a node can stop answering without an error.
   */
  const STALL_MS = 30_000;

  /** Whether the sync under way got nothing back for that long. */
  let isStalled = false;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let stallTimer;

  /**
   * Starts the wait again whenever the sync moves, and ends it with the sync.
   *
   * @param {boolean} isInProgress
   * @param {...unknown} moved What changes as it gets something back
   */
  function watchStall(isInProgress, ...moved) {
    void moved;
    clearTimeout(stallTimer);
    isStalled = false;

    if (isInProgress) {
      stallTimer = setTimeout(() => {
        isStalled = true;
      }, STALL_MS);
    }
  }

  onDestroy(() => clearTimeout(stallTimer));

  /**
   * Whether a sync failed as the network couldn't be reached, as the browser
   * says it: "Failed to fetch", "Load failed" or a NetworkError.
   *
   * @param {Error | null} error
   */
  const isUnreachable = (error) =>
    /failed to fetch|fetch failed|load failed|networkerror/i.test(
      error?.message ?? ""
    );

  $: ({ networkName } = $networkStore);
  $: ({ syncStatus } = $walletStore);
  $: watchStall(
    syncStatus.isInProgress,
    syncStatus.progress,
    syncStatus.from,
    syncStatus.last
  );
  $: label = networkLabel(networkName);
  $: state = isOffline
    ? "offline"
    : isStalled || isUnreachable(syncStatus.error)
      ? "unreachable"
      : syncStatus.error
        ? "error"
        : syncStatus.isInProgress
          ? "syncing"
          : "synced";
  $: stateText =
    state === "offline"
      ? "Offline"
      : state === "unreachable"
        ? "Can't reach the network"
        : state === "error"
          ? "Sync failed"
          : state === "syncing"
            ? `Syncing${syncStatus.progress ? ` ${Math.round(syncStatus.progress * 100)}%` : ""}`
            : "In sync";
  // Said on the pill too, not by its dot alone.
  $: problem =
    state === "offline" || state === "unreachable"
      ? "Offline"
      : state === "error"
        ? "Sync failed"
        : "";

  function retry() {
    // A sync that stalled still runs, and another asked for would join it:
    // it stops, and a new one takes its place.
    if (isStalled) {
      walletStore.abortSync();
    }

    walletStore.sync().catch(() => {});
  }

  /**
   * Opens the panel, as a step of its own in the browser's history, as the
   * profile menu does: phone Back closes it, and leaves the page as it was.
   */
  function openPanel() {
    open = true;

    // After Forward the history is at the panel's step already.
    if (!$page?.state?.networkPanel) {
      pushState("", { ...$page?.state, networkPanel: true });
    }
  }

  /** Closes the panel, and its step in the history goes. */
  function closePanel() {
    const wasOpen = open;

    open = false;

    if (wasOpen && $page?.state?.networkPanel) {
      history.back();
    }
  }

  /** Whether the history was at the panel's step. */
  let wasAtPanel = false;

  /**
   * Back closes the panel, and nothing else.
   *
   * @param {boolean} isAtPanel
   */
  function followHistory(isAtPanel) {
    if (wasAtPanel && !isAtPanel) {
      open = false;
    }

    wasAtPanel = isAtPanel;
  }

  /** The page the panel opened on. */
  let shownHref = "";

  /**
   * Any navigation closes the panel: it would stay over the next page.
   *
   * @param {string} href
   */
  function followPage(href) {
    if (href !== shownHref) {
      shownHref = href;
      open = false;
    }
  }

  $: followPage(String($page?.url ?? ""));
  $: followHistory(Boolean($page?.state?.networkPanel));
</script>

<svelte:window
  on:offline={() => {
    isOffline = true;
  }}
  on:online={() => {
    isOffline = false;
  }}
/>

<div
  class="network-pill"
  use:handlePageClick={{
    callback: closePanel,
    enabled: open,
    swallow: true,
  }}
>
  <button
    aria-expanded={open}
    aria-haspopup="dialog"
    aria-label={`Network: ${label}, ${stateText.toLowerCase()}`}
    class="network-pill__button"
    class:network-pill__button--problem={problem}
    on:click={() => {
      if (open) {
        closePanel();
      } else {
        openPanel();
      }
    }}
    on:keydown={(event) => {
      if (event.key === "Escape") {
        closePanel();
      }
    }}
    type="button"
  >
    <span
      aria-hidden="true"
      class="network-pill__dot network-pill__dot--{state}"
    ></span>
    <span class="network-pill__name">{label}</span>
    {#if problem}
      <span aria-hidden="true" class="network-pill__problem">{problem}</span>
    {/if}
    <Icon className="network-pill__chevron" path={mdiChevronDown} />
  </button>
  {#if open}
    <div aria-label="Network" class="network-pill__popover" role="dialog">
      <p class="network-pill__title">Dusk {label}</p>
      <p class="network-pill__state network-pill__state--{state}">
        {stateText}
      </p>
      {#if state === "syncing" && syncStatus.progress}
        <SyncBar
          from={syncStatus.from}
          last={syncStatus.last}
          progress={syncStatus.progress}
        />
      {/if}
      {#if state === "offline"}
        <p class="network-pill__error">
          Your balance may be out of date until you're back online.
        </p>
      {:else if state === "unreachable"}
        <p class="network-pill__error">Your balance may be out of date.</p>
        <Button on:click={retry} size="small" text="Try again" />
      {:else if state === "error"}
        <p class="network-pill__error">{syncStatus.error?.message}</p>
        <p class="network-pill__error">Your balance may be out of date.</p>
        <Button on:click={retry} size="small" text="Try again" />
      {/if}
    </div>
  {/if}
</div>

<style lang="postcss">
  .network-pill {
    position: relative;
  }

  .network-pill__button {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 2.375rem;
    min-width: 44px;
    padding: 0 0.75rem;
    border-radius: 999px;
    background: var(--calm-s1);
    color: var(--calm-text);
    font-size: 0.875rem;
    cursor: pointer;
    white-space: nowrap;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }

    & :global(.network-pill__chevron) {
      width: 0.875rem;
      height: 0.875rem;
      color: var(--calm-muted);
    }
  }

  .network-pill__dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    background: var(--calm-online);
    flex: 0 0 auto;

    &--syncing {
      background: var(--calm-pending);
      animation: network-pill-pulse 1.6s ease-in-out infinite;
    }

    &--error,
    &--offline,
    &--unreachable {
      background: var(--calm-danger);
    }
  }

  .network-pill__problem {
    color: var(--calm-danger);
  }

  /*
   * Phones: no chevron, as the profile's pill; below 420 px the dot alone,
   * where the profile's pill needs the room, with the network's name still
   * there for screen readers.
   */
  @media (max-width: 47.99rem) {
    .network-pill__button {
      gap: 0.375rem;
      padding: 0 0.625rem;
    }

    .network-pill__button :global(.network-pill__chevron) {
      display: none;
    }
  }

  /* A thumb's. What the style sheets ask for can't reach past the reset above. */
  @media (max-width: 47.99rem), (pointer: coarse) {
    .network-pill__button {
      height: 44px;
    }
  }

  @media (max-width: 26.24rem) {
    .network-pill__button {
      justify-content: center;
      width: 44px;
      padding: 0;
    }

    /* A problem is said in a word, beside the dot. */
    .network-pill__button--problem {
      width: auto;
      padding: 0 0.625rem;
    }

    .network-pill__name {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }
  }

  @keyframes network-pill-pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .network-pill__dot--syncing {
      animation: none;
    }
  }

  .network-pill__popover {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    z-index: 20;
    width: min(18rem, calc(100vw - 2rem));
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    border-radius: 1rem;
    background: var(--calm-s1);
    border: 1px solid var(--calm-line2);
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.28);
    font-size: 0.875rem;
  }

  /*
   * Phones: against the window, under the top bar. The pill sits too far
   * right for the popover to open under it.
   */
  @media (max-width: 47.99rem) {
    .network-pill__popover {
      position: fixed;
      top: calc(var(--header-height, 3.75rem) + 0.5rem);
      right: 1rem;
    }
  }

  .network-pill__title {
    font-weight: 500;
  }

  .network-pill__state {
    color: var(--calm-muted);

    &--error,
    &--offline,
    &--unreachable {
      color: var(--calm-danger);
    }
  }

  .network-pill__error {
    color: var(--calm-muted);
    overflow-wrap: anywhere;
  }
</style>
