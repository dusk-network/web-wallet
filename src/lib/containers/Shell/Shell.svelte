<script>
  import { page } from "$app/stores";
  import { isHistoryEnabled } from "$lib/activity";
  import { contractDescriptors } from "$lib/contracts";
  import { walletStore } from "$lib/stores";

  import CommandBar from "./CommandBar.svelte";
  import TabBar from "./TabBar.svelte";
  import TopBar from "./TopBar.svelte";
  import keyboardInset from "./keyboardInset";
  import { appPath, shellTabs, tabOf } from "./navigation";

  /** @param {string} id */
  const isEnabled = (id) =>
    contractDescriptors.some((c) => c.id === id && c.enabled === true);

  const tabs = shellTabs({
    history: isHistoryEnabled(),
    stake: isEnabled("stake"),
  });

  /** The pages and actions the search knows. */
  const pages = [
    ...tabs.map(({ href, label }) => ({ href, label })),
    ...[
      { href: "/dashboard/send", id: "send", keywords: "pay", label: "Send" },
      {
        href: "/dashboard/receive",
        id: "receive",
        keywords: "address qr",
        label: "Receive",
      },
      {
        href: "/dashboard/allocate",
        id: "allocate",
        keywords: "allocate unshield",
        label: "Shield",
      },
      {
        href: "/dashboard/bridge",
        id: "bridge",
        keywords: "duskevm",
        label: "Bridge",
      },
      {
        href: "/dashboard/migrate",
        id: "migrate",
        keywords: "erc20 bep20",
        label: "Migrate",
      },
    ]
      .filter(({ id }) => isEnabled(id))
      .map(({ href, keywords, label }) => ({ href, keywords, label })),
    { href: "/settings", keywords: "gas lock password", label: "Settings" },
  ];

  let searchOpen = false;
  let typing = false;

  /** @param {KeyboardEvent} event */
  function handleShortcut(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchOpen = true;
    }
  }

  /** @param {FocusEvent} event */
  function handleFocusIn(event) {
    const target = /** @type {HTMLElement | null} */ (event.target);

    typing = Boolean(
      target?.matches?.(
        "textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])"
      )
    );
  }

  $: activeTab = tabOf(tabs, $page.url.pathname);
  $: settingsOpen = appPath($page.url.pathname) === "/settings";

  // The current profile's history, kept in step with it.
  $: if ($walletStore.currentProfile) {
    walletStore.startHistory();
  }
</script>

<svelte:window on:keydown={handleShortcut} />

<div
  class="shell"
  class:shell--flow={activeTab === null}
  class:shell--typing={typing}
  on:focusin={handleFocusIn}
  on:focusout={() => {
    typing = false;
  }}
  use:keyboardInset
>
  <a class="shell__skip" href="#shell-main">Skip to content</a>
  <TopBar
    {activeTab}
    on:search={() => {
      searchOpen = true;
    }}
    {settingsOpen}
    {tabs}
  />
  <div class="shell__main" id="shell-main" tabindex="-1">
    <slot />
  </div>
  <TabBar {activeTab} {tabs} />
  {#if searchOpen}
    <CommandBar
      on:close={() => {
        searchOpen = false;
      }}
      {pages}
    />
  {/if}
</div>

<style lang="postcss">
  .shell {
    --top-bar-height: 3.75rem;
    --tab-bar-height: 4.5rem;

    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--calm-s0);
    color: var(--calm-text);
  }

  .shell__skip {
    position: absolute;
    left: 1rem;
    top: -4rem;
    z-index: 40;
    padding: 0.75rem 1rem;
    border-radius: 999px;
    background: var(--calm-pill);
    color: var(--calm-on-pill);

    &:focus {
      top: 0.5rem;
    }
  }

  .shell__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    outline: none;
  }

  /* The tab bar: phones only, not in flows, not while typing. */
  .shell :global(.tab-bar) {
    display: none;
  }

  @media (max-width: 47.99rem) {
    .shell:not(.shell--flow):not(.shell--typing) :global(.tab-bar) {
      display: grid;
    }

    .shell:not(.shell--flow) .shell__main {
      padding-bottom: calc(var(--tab-bar-height) + env(safe-area-inset-bottom));
    }
  }
</style>
