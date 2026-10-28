<script>
  import { mdiChevronDown } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import { SyncBar } from "$lib/components";
  import { handlePageClick } from "$lib/dusk/ui-helpers/handlePageClick";
  import { networkStore, walletStore } from "$lib/stores";

  import { networkLabel } from "./navigation";

  let open = false;

  $: ({ networkName } = $networkStore);
  $: ({ syncStatus } = $walletStore);
  $: label = networkLabel(networkName);
  $: state = syncStatus.error
    ? "error"
    : syncStatus.isInProgress
      ? "syncing"
      : "synced";
  $: stateText =
    state === "error"
      ? "Sync failed"
      : state === "syncing"
        ? `Syncing${syncStatus.progress ? ` ${Math.round(syncStatus.progress * 100)}%` : ""}`
        : "In sync";

  function retry() {
    walletStore.sync().catch(() => {});
  }
</script>

<div
  class="network-pill"
  use:handlePageClick={{
    callback: () => {
      open = false;
    },
    enabled: open,
  }}
>
  <button
    aria-expanded={open}
    aria-haspopup="dialog"
    aria-label={`Network: ${label}, ${stateText.toLowerCase()}`}
    class="network-pill__button"
    on:click={() => {
      open = !open;
    }}
    on:keydown={(event) => {
      if (event.key === "Escape") {
        open = false;
      }
    }}
    type="button"
  >
    <span
      aria-hidden="true"
      class="network-pill__dot network-pill__dot--{state}"
    ></span>
    <span class="network-pill__name">{label}</span>
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
      {#if state === "error"}
        <p class="network-pill__error">{syncStatus.error?.message}</p>
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

    &--error {
      background: var(--calm-danger);
    }
  }

  /*
   * Phones: no chevron, as the profile's pill; below 344 px the dot alone,
   * with the network's name still there for screen readers.
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

  @media (max-width: 21.49rem) {
    .network-pill__button {
      justify-content: center;
      width: 44px;
      padding: 0;
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

    &--error {
      color: var(--calm-danger);
    }
  }

  .network-pill__error {
    color: var(--calm-muted);
    overflow-wrap: anywhere;
  }
</style>
