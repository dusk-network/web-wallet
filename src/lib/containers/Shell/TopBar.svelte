<script>
  import { createEventDispatcher } from "svelte";
  import { mdiCogOutline, mdiMagnify } from "@mdi/js";
  import { Icon } from "$lib/dusk/components";
  import { AddressPicker } from "$lib/components";
  import { getPrimaryName, getVerifiedName } from "$lib/dusk-domains";
  import { addBasePath } from "$lib/navigation";
  import { networkStore, walletStore } from "$lib/stores";
  import { nodeBaseUrl } from "$lib/url";

  import DuskGlyph from "./DuskGlyph.svelte";
  import DuskWordmark from "./DuskWordmark.svelte";
  import NetworkPill from "./NetworkPill.svelte";

  /** @type {import("./navigation").ShellTab[]} */
  export let tabs;

  /** @type {string | null} */
  export let activeTab;

  /** @type {boolean} */
  export let settingsOpen = false;

  const dispatch = createEventDispatcher();

  /**
   * Looks up the verified `.dusk` names of public accounts on the network,
   * through the wallet's own node.
   *
   * @param {string} network
   * @returns {(account: string) => Promise<string>}
   */
  const lookUpNamesOn = (network) => (account) =>
    getPrimaryName(account, network, nodeBaseUrl());

  $: ({ networkName } = $networkStore);
  $: ({ currentProfile, profiles } = $walletStore);
</script>

<header class="top-bar">
  <a
    aria-label="Dusk Wallet, home"
    class="top-bar__brand"
    href={addBasePath("/dashboard")}
  >
    <DuskGlyph />
    <DuskWordmark />
    <span aria-hidden="true" class="top-bar__divider"></span>
    <span class="top-bar__app">Wallet</span>
  </a>

  <nav aria-label="Wallet pages" class="top-bar__tabs">
    {#each tabs as tab (tab.id)}
      <a
        aria-current={tab.id === activeTab ? "page" : undefined}
        class="top-bar__tab"
        class:top-bar__tab--on={tab.id === activeTab}
        href={addBasePath(tab.href)}>{tab.label}</a
      >
    {/each}
  </nav>

  <button
    aria-keyshortcuts="Control+K Meta+K /"
    aria-label="Search names, addresses and transactions"
    class="top-bar__search"
    on:click={() => dispatch("search")}
    type="button"
  >
    <Icon path={mdiMagnify} />
    <span class="top-bar__search-text"
      >Search names, addresses, transactions</span
    >
    <kbd class="top-bar__kbd">Ctrl K</kbd>
  </button>

  <NetworkPill />

  <AddressPicker
    compact
    {currentProfile}
    getKnownName={(account) => getVerifiedName(networkName, account)}
    getName={lookUpNamesOn(networkName)}
    {profiles}
    on:setCurrentProfile={(event) =>
      walletStore.setCurrentProfile(event.detail.profile)}
  />

  <a
    aria-current={settingsOpen ? "page" : undefined}
    aria-label="Settings"
    class="top-bar__settings"
    class:top-bar__settings--on={settingsOpen}
    data-tooltip-id="main-tooltip"
    data-tooltip-text="Settings"
    href={addBasePath("/settings")}
  >
    <Icon path={mdiCogOutline} />
  </a>
</header>

<style lang="postcss">
  .top-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: var(--top-bar-height);
    padding: 0 1.25rem 0 1.5rem;
    border-bottom: 1px solid var(--calm-line);
    background: var(--calm-s0);

    /*
     * Nothing in the bar shrinks under its content to make room, but the
     * profile's name, which is cut short where it doesn't fit.
     */
    & > :global(*) {
      flex-shrink: 0;
    }

    & > :global(.address-picker--compact) {
      flex-shrink: 1;
    }
  }

  /*
   * The wordmark, a thin line and WALLET in the ledger's type; the round
   * mark alone where the wordmark doesn't fit, below 374 px.
   */
  .top-bar__brand :global(.dusk-glyph) {
    display: none;
  }

  .top-bar__brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-right: 1.375rem;
    min-height: 44px;
    color: var(--calm-text);
    text-decoration: none;
    white-space: nowrap;
  }

  .top-bar__divider {
    width: 1px;
    height: 1rem;
    background-color: color-mix(in oklab, var(--calm-text), transparent 72%);
    flex: 0 0 auto;
  }

  .top-bar__app {
    font-family: var(--code-font-family);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    line-height: 1;
    text-transform: uppercase;
  }

  .top-bar__tabs {
    display: flex;
    align-self: stretch;
  }

  .top-bar__tab {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 0.875rem;
    color: var(--calm-muted);
    font-size: 0.90625rem;
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      color: var(--calm-text);
    }

    &--on {
      color: var(--calm-text);

      &::after {
        content: "";
        position: absolute;
        left: 0.875rem;
        right: 0.875rem;
        bottom: -1px;
        height: 2px;
        border-radius: 2px;
        background: var(--calm-text);
      }
    }
  }

  .top-bar__search {
    all: unset;
    box-sizing: border-box;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: min(23.75rem, 32vw);
    height: 2.375rem;
    margin-left: auto;
    padding: 0 0.5rem 0 0.875rem;
    border-radius: 0.625rem;
    background: var(--calm-s1);
    color: var(--calm-subtle);
    font-size: 0.84375rem;
    cursor: text;

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
      flex: 0 0 auto;
    }
  }

  .top-bar__search-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top-bar__kbd {
    display: inline-flex;
    align-items: center;
    height: 1.375rem;
    padding: 0 0.4375rem;
    border: 1px solid var(--calm-line2);
    border-radius: 0.375rem;
    color: var(--calm-muted);
    font-family: inherit;
    font-size: 0.75rem;
  }

  .top-bar__settings {
    display: grid;
    place-items: center;
    width: 2.375rem;
    height: 2.375rem;
    border-radius: 50%;
    color: var(--calm-muted);

    &:hover,
    &--on {
      color: var(--calm-text);
      background: var(--calm-s1);
    }
  }

  .top-bar__search,
  .top-bar__brand,
  .top-bar__tab,
  .top-bar__settings {
    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }
  }

  /*
   * What fits beside the tabs, the longest profile name and the network
   * pill's longest label (Connecting): WALLET with the search's field from
   * 1400 px, the field from 1320 px (a search button below), and the
   * profile's name in full from 976 px, as AddressPicker shows it; below,
   * its .dusk name without the ending, cut short where it doesn't fit.
   */
  @media (max-width: 87.49rem) {
    .top-bar__divider,
    .top-bar__app {
      display: none;
    }
  }

  @media (max-width: 82.49rem) {
    .top-bar__search {
      width: 2.375rem;
      padding: 0;
      justify-content: center;
      border-radius: 50%;
      background: none;
      color: var(--calm-text);

      & :global(.dusk-icon) {
        width: 1.25rem;
        height: 1.25rem;
      }
    }

    .top-bar__search-text,
    .top-bar__kbd {
      display: none;
    }
  }

  @media (max-width: 47.99rem) {
    .top-bar {
      padding: 0 0.75rem 0 1rem;
      gap: 0.25rem;
    }

    .top-bar__brand {
      margin-right: 0;
    }

    .top-bar__tabs {
      display: none;
    }

    .top-bar__search,
    .top-bar__settings {
      width: 44px;
      height: 44px;
    }
  }

  @media (max-width: 23.37rem) {
    .top-bar__brand :global(.dusk-glyph) {
      display: block;
    }

    .top-bar__brand :global(.dusk-wordmark) {
      display: none;
    }
  }
</style>
