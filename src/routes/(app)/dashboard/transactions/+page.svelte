<script>
  import { page } from "$app/stores";
  import { activityState, isHistoryEnabled } from "$lib/activity";
  import { HistoryView } from "$lib/containers/History";
  import { appPath } from "$lib/containers/Shell";
  import { goto } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";

  /** @type {Set<string>} */
  const KINDS = new Set(["all", "bridge", "received", "sent", "staking"]);

  /**
   * Opens a transaction's details, or closes them, in the address.
   *
   * @param {string | null} hash
   */
  function select(hash) {
    const next = new URL(url);

    if (hash) {
      next.searchParams.set("tx", hash);
      walletStore
        .startHistory()
        ?.loadDetail(hash)
        .catch(() => {});
    } else {
      next.searchParams.delete("tx");
    }

    goto(`${appPath(next.pathname)}${next.search}`, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  }

  $: ({ url } = $page);
  $: ({ language } = $settingsStore);
  $: ({ networkName } = $networkStore);
  $: kindParam = url.searchParams.get("kind") ?? "all";
  /** @type {import("$lib/activity/present").ActivityKindFilter} */
  let kind = "all";

  $: kind = KINDS.has(kindParam)
    ? /** @type {import("$lib/activity/present").ActivityKindFilter} */ (
        kindParam
      )
    : "all";
</script>

{#if isHistoryEnabled()}
  <HistoryView
    {kind}
    locale={language}
    network={networkName}
    on:more={() => {
      walletStore
        .startHistory()
        ?.showMore()
        .catch(() => {});
    }}
    on:select={(event) => select(event.detail)}
    selected={url.searchParams.get("tx")}
    state={$activityState}
  />
{:else}
  <p class="history-off">Transaction history isn't available here yet.</p>
{/if}

<style>
  .history-off {
    padding: 2rem 1.5rem;
    color: var(--calm-muted);
  }
</style>
