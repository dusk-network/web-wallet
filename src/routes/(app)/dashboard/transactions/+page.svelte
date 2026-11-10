<script>
  import { page } from "$app/stores";
  import { activityState, isHistoryEnabled } from "$lib/activity";
  import { HistoryView } from "$lib/containers/History";
  import { appPath } from "$lib/containers/Shell";
  import { sheetStep } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import { profileLabel } from "$lib/wallet";
  import { openProfileNames } from "$lib/wallets";

  /** History's filters, as its address can give them; "all" is each default. */
  const FILTERS = {
    kind: new Set(["all", "bridge", "received", "sent", "staking"]),
    privacy: new Set(["all", "public", "shielded"]),
    range: new Set(["all", "7", "30", "90"]),
  };

  /**
   * A filter from the address: the default for one that isn't there, or
   * isn't one.
   *
   * @param {URL} at
   * @param {keyof typeof FILTERS} name
   */
  const filterOf = (at, name) => {
    const value = at.searchParams.get(name) ?? "all";

    return FILTERS[name].has(value) ? value : "all";
  };

  /**
   * The kind of rows shown, from the address.
   *
   * @param {URL} at
   * @returns {import("$lib/activity/present").ActivityKindFilter}
   */
  const kindOf = (at) =>
    /** @type {import("$lib/activity/present").ActivityKindFilter} */ (
      filterOf(at, "kind")
    );

  /**
   * Goes to History as `next` says: a step of its own in the browser's history
   * as details open, so that Back closes them.
   *
   * @param {URL} next
   */
  const go = (next) =>
    sheetStep(
      `${appPath(next.pathname)}${next.search}`,
      Number(url.searchParams.has("tx")),
      Number(next.searchParams.has("tx"))
    );

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

    go(next);
  }

  /**
   * Keeps the filters picked in the address, each default left out: a
   * refresh, Back or a link shows the history as it was.
   *
   * @param {Record<string, string>} picked
   */
  function filter(picked) {
    const next = new URL(url);

    for (const [name, value] of Object.entries(picked)) {
      if (value === "all" || value === "") {
        next.searchParams.delete(name);
      } else {
        next.searchParams.set(name, value);
      }
    }

    go(next);
  }

  $: ({ url } = $page);
  $: ({ language } = $settingsStore);
  $: ({ networkName } = $networkStore);
  $: ({ currentProfile, profiles } = $walletStore);
  $: account = currentProfile
    ? {
        address: String(currentProfile.account),
        label: profileLabel(
          profiles,
          currentProfile,
          networkName,
          $openProfileNames
        ),
      }
    : null;
  $: kind = kindOf(url);
  $: privacy = filterOf(url, "privacy");
  $: range = filterOf(url, "range");
  // A search's See all: what it finds.
  $: query = url.searchParams.get("q") ?? "";
</script>

{#if isHistoryEnabled()}
  <HistoryView
    {account}
    {kind}
    locale={language}
    network={networkName}
    on:filter={(event) => filter(event.detail)}
    on:select={(event) => select(event.detail)}
    {privacy}
    onMore={() => walletStore.startHistory()?.showMore() ?? Promise.resolve()}
    {query}
    {range}
    selected={url.searchParams.get("tx")}
    shieldedAddress={currentProfile ? String(currentProfile.address) : ""}
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
