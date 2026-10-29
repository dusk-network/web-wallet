<script>
  import { createEventDispatcher, onMount, tick } from "svelte";
  import {
    mdiAlertOutline,
    mdiClose,
    mdiContentCopy,
    mdiMagnify,
  } from "@mdi/js";
  import { Icon } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { activityState } from "$lib/activity";
  import { archiveQuery, fetchTxDetails } from "$lib/activity/activityHistory";
  import {
    configuredBridgeContracts,
    shortAddress,
  } from "$lib/activity/present";
  import reservedNames from "$lib/activity/reservedNames";
  import { getVerifiedName, resolveDuskName } from "$lib/dusk-domains";
  import { goto } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import nodeNetwork from "$lib/stores/nodeNetwork";
  import { duskExplorerBlock, duskExplorerTx, nodeBaseUrl } from "$lib/url";

  import { contactNamesOf, contactsStore } from "$lib/contacts";
  import { sozuPools } from "$lib/sozu";
  import { lookupKind, lookupName, searchLocally } from "./search";

  /** @type {{ href: string, keywords?: string, label: string }[]} */
  export let pages;

  const dispatch = createEventDispatcher();

  /** @type {HTMLInputElement} */
  let input;

  /** @type {HTMLButtonElement | undefined} */
  let closeButton;

  let query = "";
  let active = 0;

  /**
   * What Enter looked up on the network for the last query, if anything.
   *
   * @type {{ query: string, state: "done" | "running", results: import("./search").SearchResult[], message: string } | null}
   */
  let lookup = null;

  /** @type {Element | null} */
  const opener = document.activeElement;

  const bridgeContracts = configuredBridgeContracts();

  const close = () => dispatch("close");

  $: ({ networkName } = $networkStore);
  $: ({ profiles } = $walletStore);
  $: ({ language } = $settingsStore);
  $: void reservedNames.load($activityState.rows);
  $: index = {
    contacts: $contactsStore,
    history: $activityState.rows,
    locale: language,
    network: networkName,
    pages,
    // The history's rows told as History tells them.
    present: {
      bridgeContracts,
      contactNames: contactNamesOf($contactsStore),
      net: $nodeNetwork,
      reservations: $reservedNames,
      sozuPools: $sozuPools,
    },
    profiles: profiles.map((profile, i) => {
      const account = String(profile.account);

      return {
        account,
        address: String(profile.address),
        label: `Profile ${i + 1}`,
        name: getVerifiedName(networkName, account),
      };
    }),
  };
  $: found = searchLocally(query, index);
  $: results =
    lookup && lookup.query === query.trim()
      ? [...found, ...lookup.results]
      : found;
  $: if (active >= results.length) {
    active = Math.max(0, results.length - 1);
  }

  /**
   * @param {string} value
   */
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      toast("success", "Copied", mdiContentCopy);
    } catch {
      toast("error", "Couldn't copy", mdiContentCopy);
    }
  }

  /**
   * Opens a block in the Dusk explorer, which goes by the block's hash: the
   * tab opens on the click, and goes to the block once the node gives its
   * hash for the height.
   *
   * @param {string} height
   */
  async function openBlock(height) {
    const tab = window.open("", "_blank");

    try {
      const data = await archiveQuery(
        nodeBaseUrl(),
        `query { block(height: ${height}) { header { hash } } }`
      );
      const hash = data?.block?.header?.hash;

      if (typeof hash !== "string" || !hash) {
        throw new Error("No block at this height");
      }

      if (tab) {
        tab.opener = null;
        tab.location.href = duskExplorerBlock(hash);
      }

      close();
    } catch {
      tab?.close();
      toast("error", `Couldn't find block ${height}`, mdiAlertOutline);
    }
  }

  /**
   * Opens a result: its page, or Send for a person. With Shift, a result
   * that has an address copies it instead.
   *
   * @param {import("./search").SearchResult} result
   * @param {{ copyOnly?: boolean }} [options]
   */
  function activate(result, { copyOnly = false } = {}) {
    if (copyOnly && result.value) {
      copy(result.value);
    } else if (result.block) {
      openBlock(result.block);
    } else if (result.external && result.href) {
      window.open(result.href, "_blank", "noopener,noreferrer");
    } else if (result.href) {
      close();
      goto(result.href);
    } else if (result.value) {
      copy(result.value);
    }
  }

  /**
   * Looks the query up on the network, once: a .dusk name, a transaction
   * ID or an address.
   *
   * @param {string} q
   */
  async function lookUp(q) {
    const kind = lookupKind(q);

    if (!kind) {
      lookup = {
        message:
          "Nothing found. Try a .dusk name, an address or a transaction ID.",
        query: q,
        results: [],
        state: "done",
      };

      return;
    }

    lookup = {
      message: "Looking it up…",
      query: q,
      results: [],
      state: "running",
    };

    const done = await (kind === "name"
      ? lookUpName(lookupName(q))
      : kind === "transaction"
        ? lookUpTransaction(q)
        : lookUpAddress(q));

    if (lookup?.query === q) {
      lookup = { ...done, query: q, state: "done" };
    }
  }

  /** @param {string} q */
  async function lookUpName(q) {
    const resolved = await resolveDuskName(q, networkName, nodeBaseUrl());
    const address = resolved.account ?? resolved.address;

    if (!address) {
      return {
        message:
          resolved.error === "not-registered"
            ? `${resolved.name} isn't registered.`
            : `Couldn't look up ${resolved.name}.`,
        results: [],
      };
    }

    return {
      message: "",
      results: [
        /** @type {import("./search").SearchResult} */ ({
          detail: shortAddress(address),
          detailIsCode: true,
          group: "People",
          href: `/dashboard/send?to=${encodeURIComponent(resolved.name)}`,
          id: `lookup:${resolved.name}`,
          label: `Send to ${resolved.name}`,
          value: address,
        }),
      ],
    };
  }

  /** @param {string} q */
  async function lookUpTransaction(q) {
    const hash = q.replace(/^0x/i, "").toLowerCase();
    const details = await fetchTxDetails(nodeBaseUrl(), [hash]).catch(
      () => null
    );

    if (!details) {
      return { message: "Couldn't look the transaction up.", results: [] };
    }

    const tx = details.get(hash);

    return tx
      ? {
          message: "",
          results: [
            /** @type {import("./search").SearchResult} */ ({
              detail: tx.success ? "Completed" : "Failed",
              external: true,
              group: "Transactions",
              href: duskExplorerTx(hash),
              id: `lookup:${hash}`,
              label: `View ${shortAddress(hash)} in Dusk explorer`,
            }),
          ],
        }
      : {
          message: "No transaction with this ID on this network.",
          results: [],
        };
  }

  /** @param {string} q */
  async function lookUpAddress(q) {
    const address = q.trim();

    return {
      message: "",
      results: [
        /** @type {import("./search").SearchResult} */ ({
          detail: shortAddress(address),
          detailIsCode: true,
          group: "People",
          href: `/dashboard/send?to=${encodeURIComponent(address)}`,
          id: `lookup:${address}`,
          label: "Send to this address",
          value: address,
        }),
      ],
    };
  }

  /**
   * Tab and Shift+Tab move between the dialog's two controls, the input and
   * its close button: focus stays in the dialog.
   *
   * @param {KeyboardEvent} event
   * @param {HTMLElement | undefined} next
   */
  function cycleFocus(event, next) {
    event.preventDefault();
    next?.focus();
  }

  /** @param {KeyboardEvent} event */
  function handleCloseKeydown(event) {
    if (event.key === "Tab") {
      cycleFocus(event, input);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        active = results.length ? (active + 1) % results.length : 0;
        break;
      case "ArrowUp":
        event.preventDefault();
        active = results.length
          ? (active - 1 + results.length) % results.length
          : 0;
        break;
      case "Enter":
        event.preventDefault();

        if (query.trim() && !found.length && lookup?.query !== query.trim()) {
          lookUp(query.trim());
        } else if (results[active]) {
          activate(results[active], { copyOnly: event.shiftKey });
        }

        break;
      case "Tab":
        cycleFocus(event, closeButton);
        break;
      default:
        break;
    }
  }

  onMount(() => {
    tick().then(() => input?.focus());

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  });
</script>

<div
  class="command-bar__scrim"
  on:click={close}
  on:keydown={() => {}}
  role="presentation"
></div>
<div aria-label="Search" aria-modal="true" class="command-bar" role="dialog">
  <div class="command-bar__field">
    <Icon path={mdiMagnify} />
    <input
      aria-activedescendant={results[active]
        ? `command-${results[active].id}`
        : undefined}
      aria-autocomplete="list"
      aria-controls="command-results"
      aria-expanded="true"
      aria-label="Search names, addresses and transactions"
      autocomplete="off"
      bind:this={input}
      bind:value={query}
      class="command-bar__input"
      on:input={() => {
        active = 0;
      }}
      on:keydown={handleKeydown}
      placeholder="Search names, addresses, transactions"
      role="combobox"
      spellcheck="false"
      type="text"
    />
    <button
      aria-label="Close search"
      bind:this={closeButton}
      class="command-bar__close"
      on:click={close}
      on:keydown={handleCloseKeydown}
      type="button"
    >
      <Icon path={mdiClose} />
    </button>
  </div>

  <ul
    aria-label="Results"
    class="command-bar__results"
    id="command-results"
    role="listbox"
  >
    {#each results as result, i (result.id)}
      {#if i === 0 || results[i - 1].group !== result.group}
        <li class="command-bar__group" role="presentation">{result.group}</li>
      {/if}
      <li
        aria-selected={i === active}
        class="command-bar__result"
        class:command-bar__result--active={i === active}
        id={`command-${result.id}`}
        on:click={() => activate(result)}
        on:keydown={() => {}}
        on:mousemove={() => {
          active = i;
        }}
        role="option"
      >
        <span class="command-bar__text">
          <span
            class="command-bar__label"
            class:command-bar__code={result.labelIsCode}>{result.label}</span
          >
          {#if result.sub}
            <span class="command-bar__sub command-bar__code">{result.sub}</span>
          {/if}
        </span>
        {#if result.detail}
          <span
            class="command-bar__detail"
            class:command-bar__code={result.detailIsCode}
            class:command-bar__detail--end={result.sub}>{result.detail}</span
          >
        {/if}
        {#if result.hint}
          <span class="command-bar__hint">{result.hint}</span>
        {:else if !result.href && result.value}
          <span class="command-bar__hint">Copy</span>
        {/if}
      </li>
    {/each}
  </ul>

  {#if lookup && lookup.query === query.trim() && lookup.message}
    <p class="command-bar__message" role="status">{lookup.message}</p>
  {:else if query.trim() && !results.length}
    <p class="command-bar__message">
      {lookupKind(query) === "name"
        ? `Nothing on this device. Press Enter to look up ${lookupName(query)} on the network.`
        : "Nothing on this device. Press Enter to look it up on the network."}
    </p>
  {/if}

  <p class="command-bar__note">Enter: open · Shift+Enter: copy</p>
</div>

<style lang="postcss">
  .command-bar__scrim {
    position: fixed;
    inset: 0;
    z-index: 30;
    background: var(--calm-scrim);
  }

  .command-bar {
    position: fixed;
    top: 12vh;
    left: 50%;
    z-index: 31;
    width: min(40rem, calc(100vw - 2rem));
    max-height: 70vh;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    border-radius: 1rem;
    border: 1px solid var(--calm-line2);
    background: var(--calm-s1);
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.4);
    overflow: hidden;
  }

  .command-bar__field {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0 0.5rem 0 1rem;
    border-bottom: 1px solid var(--calm-line);
    color: var(--calm-subtle);

    & :global(.dusk-icon) {
      width: 1.125rem;
      height: 1.125rem;
      flex: 0 0 auto;
    }
  }

  .command-bar__input {
    flex: 1;
    min-width: 0;
    height: 3.25rem;
    border: 0 none;
    background: none;
    color: var(--calm-text);
    font: inherit;
    font-size: 1rem;
    outline: none;
  }

  .command-bar__close {
    all: unset;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--calm-muted);
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .command-bar__results {
    list-style: none;
    margin: 0;
    padding: 0.375rem;
    overflow-y: auto;
  }

  .command-bar__group {
    padding: 0.625rem 0.75rem 0.25rem;
    color: var(--calm-subtle);
    font-size: 0.78125rem;
  }

  .command-bar__result {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    min-height: 44px;
    padding: 0.625rem 0.75rem;
    border-radius: 0.625rem;
    cursor: pointer;

    &--active {
      background: var(--calm-s2);
    }
  }

  .command-bar__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .command-bar__label,
  .command-bar__sub {
    color: var(--calm-text);
    font-size: 0.90625rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A call's method, under the transaction it names. */
  .command-bar__sub {
    color: var(--calm-muted);
  }

  .command-bar__detail,
  .command-bar__hint {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  .command-bar__hint,
  .command-bar__detail--end {
    margin-left: auto;
  }

  .command-bar__code {
    font-family: var(--code-font-family);
    font-size: 0.8125rem;
  }

  .command-bar__message,
  .command-bar__note {
    padding: 0.75rem 1rem;
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .command-bar__note {
    border-top: 1px solid var(--calm-line);
    color: var(--calm-subtle);
  }
</style>
