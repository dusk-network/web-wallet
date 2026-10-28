<script>
  import { page } from "$app/stores";
  import { activityState, isHistoryEnabled } from "$lib/activity";
  import { HistoryView } from "$lib/containers/History";
  import { appPath } from "$lib/containers/Shell";
  import { goto } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import { profileLabel } from "$lib/wallet";

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
   * Goes to History as `next` says, in place of the address now.
   *
   * @param {URL} next
   */
  const replace = (next) =>
    goto(`${appPath(next.pathname)}${next.search}`, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });

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

    replace(next);
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
      if (value === "all") {
        next.searchParams.delete(name);
      } else {
        next.searchParams.set(name, value);
      }
    }

    replace(next);
  }

  $: ({ url } = $page);
  $: ({ language } = $settingsStore);
  $: ({ networkName } = $networkStore);
  $: ({ currentProfile, profiles } = $walletStore);
  $: account = currentProfile
    ? {
        address: String(currentProfile.account),
        label: profileLabel(profiles, currentProfile, networkName),
      }
    : null;
  $: kind = kindOf(url);
  $: privacy = filterOf(url, "privacy");
  $: range = filterOf(url, "range");
</script>

{#if isHistoryEnabled()}
  <HistoryView
    {account}
    {kind}
    locale={language}
    network={networkName}
    on:more={() => {
      walletStore
        .startHistory()
        ?.showMore()
        .catch(() => {});
    }}
    on:filter={(event) => filter(event.detail)}
    on:select={(event) => select(event.detail)}
    {privacy}
    {range}
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
