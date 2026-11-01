<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { makeClassName, randomUUID, shortenAddress } from "$lib/dusk/string";
  import {
    mdiAlertOutline,
    mdiChevronDown,
    mdiContentCopy,
    mdiPlus,
  } from "@mdi/js";
  import { Icon } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { handlePageClick } from "$lib/dusk/ui-helpers/handlePageClick";

  import Overlay from "./Overlay.svelte";

  import "./AddressPicker.css";

  /** @type {Profile | null} */
  export let currentProfile;

  /** @type {Profile[]} */
  export let profiles;

  /**
   * Looks up the verified `.dusk` name of a public account: "" for none.
   *
   * @type {(account: string) => Promise<string>}
   */
  export let getName = () => Promise.resolve("");

  /**
   * The name last verified for a public account, shown while its lookup is
   * pending or when it fails, as when the node can't be reached: "" for none.
   *
   * @type {(account: string) => string}
   */
  export let getKnownName = () => "";

  /** @type {string|undefined} */
  export let className = undefined;

  /**
   * A pill for the top bar: the profile's number and its name, or its label
   * while it has none.
   */
  export let compact = false;

  /**
   * The wallets here, each with its profiles under its name, as "Wallet 1"
   * and "Wallet 2": the open one's are `profiles`, another's its public
   * accounts and shielded addresses as it last showed them, which copy as
   * the open one's do. None lists the profiles alone.
   *
   * @type {Array<{ accounts: string[], addresses?: string[], key: string, label: string, open: boolean }>}
   */
  export let wallets = [];

  /** Whether the list offers Add wallet. */
  export let canAddWallet = false;

  const dispatch = createEventDispatcher();

  let expanded = false;
  let isMounted = false;

  const currentProfileId = `${randomUUID()}-current-profile`;

  onMount(() => {
    isMounted = true;
  });

  /** @type {HTMLMenuElement} */
  let addressOptionsMenu;

  function closeDropDown() {
    expanded = false;
  }

  function toggleDropDown() {
    expanded = !expanded;
  }

  /** @type {import("svelte/elements").MouseEventHandler<HTMLDivElement>} */
  function handleTriggerClick() {
    toggleDropDown();
  }

  /** @type {import("svelte/elements").KeyboardEventHandler<HTMLDivElement>} */
  function handleTriggerKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDropDown();
    }
    if (event.key === "Escape") {
      closeDropDown();
    }
    if (event.key === "ArrowDown" && !expanded) {
      event.preventDefault();
      toggleDropDown();
    }
  }

  /**
   * @param {Profile} profile
   */
  function handleProfileSelect(profile) {
    dispatch("setCurrentProfile", { profile });
    closeDropDown();
  }

  /**
   * Another wallet's profile: that wallet opens, at it.
   *
   * @param {string} key
   * @param {number} index
   */
  function handleWalletProfileSelect(key, index) {
    dispatch("switchWallet", { index, key });
    closeDropDown();
  }

  function handleAddWallet() {
    dispatch("addWallet");
    closeDropDown();
  }

  /**
   * @param {string} address
   */
  async function handleCopyAddress(address) {
    try {
      await navigator.clipboard.writeText(address);
      toast("success", "Address copied", mdiContentCopy);
    } catch (err) {
      toast(
        "error",
        err instanceof Error && err.name === "NotAllowedError"
          ? "Clipboard access denied"
          : "Failed to copy address",
        mdiAlertOutline
      );
    }
  }

  /**
   * @param {KeyboardEvent & { currentTarget: EventTarget & HTMLButtonElement }} event
   * @param {() => void} select
   */
  function handleProfileKeyDown(event, select) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropDown();
    }
  }

  $: classes = makeClassName([
    "address-picker",
    compact && "address-picker--compact",
    className,
  ]);

  // Scrolls the address options menu to top on addresses change
  $: if (profiles && addressOptionsMenu) {
    addressOptionsMenu.scrollTo(0, 0);
  }

  $: profileNumber = currentProfile ? profiles.indexOf(currentProfile) + 1 : 0;

  $: displayedAddress = currentProfile
    ? `Profile ${profileNumber}`
    : "No profile selected";

  $: currentAccount = currentProfile ? currentProfile.account.toString() : "";

  // The current profile's name, looked up once the picker has rendered:
  // "" for none, or the name last verified when the lookup fails. The
  // profiles listed look theirs up when the list opens.
  $: currentName =
    isMounted && currentAccount
      ? getName(currentAccount).catch(() => getKnownName(currentAccount))
      : "";

  /**
   * The current profile's name as the pill shows it and says it: the name
   * last verified while it's looked up, then what the lookup finds.
   */
  let shownName = "";

  /**
   * @param {Promise<string> | string} lookup
   * @param {string} account
   */
  function followName(lookup, account) {
    shownName = account ? getKnownName(account) : "";

    if (typeof lookup !== "string") {
      lookup.then((name) => {
        if (lookup === currentName) {
          shownName = name;
        }
      });
    }
  }

  $: followName(currentName, currentAccount);

  // The pill's name: "Profile: alice.dusk (Profile 1)", or the profile's
  // label while it has no name.
  $: triggerLabel = currentProfile
    ? `Profile: ${shownName ? `${shownName} (${displayedAddress})` : displayedAddress}${walletName ? `, ${walletName}` : ""}`
    : "Profile: none selected";

  // A .dusk name without its ending, for where there's little room.
  $: shortName = shownName.endsWith(".dusk")
    ? shownName.slice(0, -".dusk".length)
    : shownName;

  // With more than one wallet, the open one's name, under the profile's.
  $: walletName =
    wallets.length > 1 ? (wallets.find((w) => w.open)?.label ?? "") : "";

  // The pill's small line: the wallet's name, and the profile its number
  // stands for.
  $: walletLine = walletName ? `${walletName} · ${displayedAddress}` : "";
</script>

{#if expanded && !compact}
  <Overlay />
{/if}

<div
  use:handlePageClick={{
    callback: closeDropDown,
    enabled: expanded,
  }}
  class={classes}
  class:address-picker--expanded={expanded}
>
  <div
    class="address-picker__trigger"
    class:address-picker__trigger--named={compact && Boolean(shownName)}
    class:address-picker__trigger--wallet={compact && Boolean(walletName)}
    role="button"
    tabindex="0"
    aria-haspopup="menu"
    aria-expanded={expanded}
    aria-label={triggerLabel}
    aria-describedby={compact ? undefined : currentProfileId}
    on:click={handleTriggerClick}
    on:keydown={handleTriggerKeyDown}
  >
    {#if compact}
      <!-- The profile's number, and its name or label: on a narrow screen
        its .dusk name without the ending, and no label. With more than one
        wallet, the wallet's name under it, and on a phone below 420 px that
        line alone. -->
      <span aria-hidden="true" class="address-picker__avatar"
        >{profileNumber || "–"}</span
      >
      <span
        aria-hidden="true"
        class="address-picker__compact-lines"
        class:address-picker__compact-lines--wallet={Boolean(walletName)}
      >
        {#if shownName}
          <span class="address-picker__compact-name" title={shownName}
            >{shortName}<span class="address-picker__tld"
              >{shownName.slice(shortName.length)}</span
            ></span
          >
        {:else}
          <span
            class="address-picker__compact-name address-picker__compact-name--label"
            >{displayedAddress}</span
          >
        {/if}
        {#if walletName}
          <!-- Where the number isn't beside it, a long wallet's name is cut
            short, never the profile. -->
          <span class="address-picker__compact-wallet" title={walletLine}
            ><span class="address-picker__pill-wallet">{walletName}</span>
            <span class="address-picker__pill-profile"
              >· {displayedAddress}</span
            ></span
          >
        {/if}
      </span>
    {:else}
      <!-- The profile's label, with its name under it, or its account,
        shortened, while it has none. -->
      <span class="address-picker__current-profile" id={currentProfileId}>
        <span class="address-picker__title">{displayedAddress}</span>
        {#if currentAccount}
          {#snippet currentNameLine(/** @type {string} */ name)}
            {#if name}
              <span class="address-picker__name" title={name}>{name}</span>
            {:else}
              <span class="address-picker__account" title={currentAccount}>
                <span aria-hidden="true">{shortenAddress(currentAccount)}</span>
                <span class="sr-only">{currentAccount}</span>
              </span>
            {/if}
          {/snippet}
          {#await currentName}
            {@render currentNameLine(getKnownName(currentAccount))}
          {:then name}
            {@render currentNameLine(name)}
          {/await}
        {/if}
      </span>
    {/if}
    <Icon path={mdiChevronDown} className="address-picker__chevron" />
  </div>

  {#if expanded}
    <div class="address-picker__drop-down">
      <ul
        class="address-picker__address-options"
        bind:this={addressOptionsMenu}
        role="menu"
        aria-label="Profile selection"
      >
        {#if wallets.length}
          <!-- Each wallet's profiles under its name: the open one's to
            pick and copy, another's to open that wallet at. -->
          {#each wallets as wallet, w (wallet.key)}
            {@const titleId = `${currentProfileId}-wallet-${w}`}
            <li class="address-picker__wallet" role="none">
              <span
                class="address-picker__wallet-title"
                id={titleId}
                role="presentation">{wallet.label}</span
              >
              <ul
                aria-labelledby={titleId}
                class="address-picker__wallet-profiles"
                role="group"
              >
                {#if wallet.open}
                  {#each profiles as profile (profile)}
                    {@render ownProfile(profile)}
                  {/each}
                {:else}
                  {#each wallet.accounts.length ? wallet.accounts : ["", ""] as account, index (`${wallet.key}-${index}`)}
                    {@render otherProfile(
                      wallet.key,
                      account,
                      wallet.addresses?.[index] ?? "",
                      index
                    )}
                  {/each}
                {/if}
              </ul>
            </li>
          {/each}
        {:else}
          {#each profiles as profile (profile)}
            {@render ownProfile(profile)}
          {/each}
        {/if}
        {#if canAddWallet}
          <li class="address-picker__add-wallet" role="none">
            <button
              class="address-picker__add-wallet-button"
              role="menuitem"
              type="button"
              on:click={handleAddWallet}
            >
              <Icon path={mdiPlus} />
              <span>Add wallet</span>
            </button>
          </li>
        {/if}
      </ul>
    </div>
  {/if}
</div>

{#snippet profileName(
  /** @type {string} */ account,
  /** @type {string} */ name
)}
  {#if name}
    <span class="address-picker__address-name" title={name}>{name}</span>
  {:else if account}
    <span class="address-picker__address-value" title={account}>
      <span aria-hidden="true">{shortenAddress(account)}</span>
      <span class="sr-only">{account}</span>
    </span>
  {/if}
{/snippet}

{#snippet copyButtons(
  /** @type {string} */ account,
  /** @type {string} */ address
)}
  <div class="address-picker__copy-buttons">
    {#if account}
      <button
        aria-label="Copy public address"
        class="address-picker__copy-button"
        type="button"
        title="Copy public address"
        on:click={() => handleCopyAddress(account)}
      >
        <Icon path={mdiContentCopy} />
        <span>Public</span>
      </button>
    {/if}
    {#if address}
      <button
        aria-label="Copy shielded address"
        class="address-picker__copy-button"
        type="button"
        title="Copy shielded address"
        on:click={() => handleCopyAddress(address)}
      >
        <Icon path={mdiContentCopy} />
        <span>Shielded</span>
      </button>
    {/if}
  </div>
{/snippet}

{#snippet ownProfile(/** @type {Profile} */ profile)}
  {@const account = profile.account.toString()}
  <li
    class="address-picker__profile"
    class:address-picker__profile--selected={profile === currentProfile}
    role="none"
  >
    <div class="address-picker__profile-container">
      <button
        class="address-picker__profile-button"
        tabindex="0"
        type="button"
        role="menuitem"
        aria-current={profile === currentProfile ? "true" : "false"}
        on:click={() => handleProfileSelect(profile)}
        on:keydown={(event) =>
          handleProfileKeyDown(event, () => handleProfileSelect(profile))}
      >
        <!-- The profile, with its name under it, or its account,
          shortened, while it has none. -->
        <span class="address-picker__profile-header">
          Profile {profiles.indexOf(profile) + 1}
          {#if profile === currentProfile}
            <span class="address-picker__current-indicator">(Current)</span>
          {/if}
        </span>
        {#await getName(account)}
          {@render profileName(account, getKnownName(account))}
        {:then name}
          {@render profileName(account, name)}
        {:catch}
          {@render profileName(account, getKnownName(account))}
        {/await}
      </button>
      {@render copyButtons(account, profile.address.toString())}
    </div>
  </li>
{/snippet}

{#snippet otherProfile(
  /** @type {string} */ key,
  /** @type {string} */ account,
  /** @type {string} */ address,
  /** @type {number} */ index
)}
  <li class="address-picker__profile" role="none">
    <div class="address-picker__profile-container">
      <button
        class="address-picker__profile-button"
        tabindex="0"
        type="button"
        role="menuitem"
        aria-current="false"
        on:click={() => handleWalletProfileSelect(key, index)}
        on:keydown={(event) =>
          handleProfileKeyDown(event, () =>
            handleWalletProfileSelect(key, index)
          )}
      >
        <!-- Its name as last verified here: no lookup until it opens. -->
        <span class="address-picker__profile-header">Profile {index + 1}</span>
        {@render profileName(account, account ? getKnownName(account) : "")}
      </button>
      <!-- What it last showed copies: nothing where nothing is known. -->
      {@render copyButtons(account, address)}
    </div>
  </li>
{/snippet}
