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

  /** @type {string|undefined} */
  export let className = undefined;

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

  $: classes = makeClassName(["address-picker", className]);

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
  // "" for none, as when the lookup fails. The profiles listed look theirs
  // up when the list opens.
  $: currentName =
    isMounted && currentAccount ? getName(currentAccount).catch(() => "") : "";
</script>

{#if expanded}
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
    role="button"
    tabindex="0"
    aria-haspopup="menu"
    aria-expanded={expanded}
    aria-label="Select address profile"
    aria-describedby={currentProfileId}
    on:click={handleTriggerClick}
    on:keydown={handleTriggerKeyDown}
  >
    <!-- The profile's label, with its name under it, or its account,
      shortened, while it has none. -->
    <span class="address-picker__current-profile" id={currentProfileId}>
      <span class="address-picker__title">{displayedAddress}</span>
      {#if currentAccount}
        {#snippet currentAccountLine()}
          <span class="address-picker__account" title={currentAccount}>
            <span aria-hidden="true">{shortenAddress(currentAccount)}</span>
            <span class="sr-only">{currentAccount}</span>
          </span>
        {/snippet}
        {#await currentName}
          {@render currentAccountLine()}
        {:then name}
          {#if name}
            <span class="address-picker__name" title={name}>{name}</span>
          {:else}
            {@render currentAccountLine()}
          {/if}
        {/await}
      {/if}
    </span>
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
                {#snippet accountLine()}
                  <span class="address-picker__address-value" title={account}>
                    <span aria-hidden="true">{shortenAddress(account)}</span>
                    <span class="sr-only">{account}</span>
                  </span>
                {/snippet}
                {#await getName(account)}
                  {@render accountLine()}
                {:then name}
                  {#if name}
                    <span class="address-picker__address-name" title={name}
                      >{name}</span
                    >
                  {:else}
                    {@render accountLine()}
                  {/if}
                {:catch}
                  {@render accountLine()}
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
