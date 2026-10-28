<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { makeClassName, randomUUID, shortenAddress } from "$lib/dusk/string";
  import { mdiAlertOutline, mdiChevronDown, mdiContentCopy } from "@mdi/js";
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
   * @param {Profile} profile
   */
  function handleProfileKeyDown(event, profile) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleProfileSelect(profile);
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
    ? `Profile: ${shownName ? `${shownName} (${displayedAddress})` : displayedAddress}`
    : "Profile: none selected";

  // A .dusk name without its ending, for where there's little room.
  $: shortName = shownName.endsWith(".dusk")
    ? shownName.slice(0, -".dusk".length)
    : shownName;
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
        its .dusk name without the ending, and no label. -->
      <span aria-hidden="true" class="address-picker__avatar"
        >{profileNumber || "–"}</span
      >
      {#if shownName}
        <span
          aria-hidden="true"
          class="address-picker__compact-name"
          title={shownName}
          >{shortName}<span class="address-picker__tld"
            >{shownName.slice(shortName.length)}</span
          ></span
        >
      {:else}
        <span
          aria-hidden="true"
          class="address-picker__compact-name address-picker__compact-name--label"
          >{displayedAddress}</span
        >
      {/if}
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
        {#each profiles as profile (profile)}
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
                on:keydown={(event) => handleProfileKeyDown(event, profile)}
              >
                <!-- The profile, with its name under it, or its account,
                  shortened, while it has none. -->
                <span class="address-picker__profile-header">
                  Profile {profiles.indexOf(profile) + 1}
                  {#if profile === currentProfile}
                    <span class="address-picker__current-indicator"
                      >(Current)</span
                    >
                  {/if}
                </span>
                {#snippet nameLine(/** @type {string} */ name)}
                  {#if name}
                    <span class="address-picker__address-name" title={name}
                      >{name}</span
                    >
                  {:else}
                    <span class="address-picker__address-value" title={account}>
                      <span aria-hidden="true">{shortenAddress(account)}</span>
                      <span class="sr-only">{account}</span>
                    </span>
                  {/if}
                {/snippet}
                {#await getName(account)}
                  {@render nameLine(getKnownName(account))}
                {:then name}
                  {@render nameLine(name)}
                {:catch}
                  {@render nameLine(getKnownName(account))}
                {/await}
              </button>
              <div class="address-picker__copy-buttons">
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
                <button
                  aria-label="Copy shielded address"
                  class="address-picker__copy-button"
                  type="button"
                  title="Copy shielded address"
                  on:click={() => handleCopyAddress(profile.address.toString())}
                >
                  <Icon path={mdiContentCopy} />
                  <span>Shielded</span>
                </button>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
