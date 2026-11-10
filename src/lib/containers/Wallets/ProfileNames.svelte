<script>
  /**
   * Settings › Profiles: a name for each of the open wallet's profiles,
   * kept for that wallet in this browser only, as the extension's Names on
   * this device. It's what the wallet calls the profile in place of
   * "Profile 1", though the top bar's pill shows a verified `.dusk` name
   * first. A name is saved as its field is left, or with Enter: at most 40
   * characters, on one line, said once the field holds that many, and never
   * cut short; empty, the profile goes by its number again. One with what
   * can't be seen in it, which can read as another name, is refused.
   */
  import { mdiAlertOutline, mdiCheck } from "@mdi/js";

  import { Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { shortenAddress } from "$lib/dusk/string";
  import { FieldLimit, SectionHead } from "$lib/components";
  import { profileNameProblem } from "$lib/contacts";
  import { WalletChangedError } from "$lib/errors";
  import { networkStore, walletStore } from "$lib/stores";
  import profileLabel from "$lib/wallet/profileLabel";
  import { profilesHere } from "$lib/wallets/accountNames";
  import {
    NAME_LIMIT,
    normalizeWalletName,
    openProfileNames,
    openWalletName,
    renameProfile,
    typedWalletName,
  } from "$lib/wallets";

  /**
   * What each field holds, by profile.
   *
   * @type {string[]}
   */
  let drafts = [];

  /**
   * Why a field's name wasn't saved, by profile.
   *
   * @type {string[]}
   */
  let refused = [];

  /**
   * The names the fields last started from, and the wallet they're of: a
   * field still showing its name follows a new one, as from another tab,
   * and one being typed in, or saved, keeps what's typed.
   */
  let shown = /** @type {string[]} */ ([]);
  let shownFor = /** @type {string | null} */ (null);

  /**
   * The name each profile was last asked to be saved with, while it's
   * being saved: what it has once the saves waiting are done.
   *
   * @type {Array<string | undefined>}
   */
  const saving = [];

  /**
   * @param {string} key
   * @param {number} count
   * @param {string[]} names
   */
  function follow(key, count, names) {
    drafts = Array.from({ length: count }, (_, i) =>
      key !== shownFor || (saving[i] === undefined && drafts[i] === shown[i])
        ? (names[i] ?? "")
        : (drafts[i] ?? "")
    );
    shown = Array.from({ length: count }, (_, i) => names[i] ?? "");
    shownFor = key;
  }

  /** @param {number} index */
  async function save(index) {
    const key = walletKey;
    const name = typedWalletName(drafts[index]);

    // Too long, it stays as typed, with the limit said under it.
    if (name.length > NAME_LIMIT) {
      return;
    }

    // Empty, it goes by its number: no other's name.
    const problem = name
      ? profileNameProblem(name, everyProfile, String(profiles[index].account))
      : null;

    if (problem) {
      refused[index] = problem;
      return;
    }

    // The field shows the name as it's kept.
    drafts[index] = name;

    // Nothing to save when it's the name the profile has, or will have once
    // a save under way is done.
    if (
      name === (saving[index] ?? normalizeWalletName($openProfileNames[index]))
    ) {
      return;
    }

    saving[index] = name;

    try {
      await renameProfile(key, index, name);
      toast("success", "Name saved.", mdiCheck);
    } catch (error) {
      toast(
        "error",
        error instanceof WalletChangedError
          ? error.message
          : "Couldn't save the name.",
        mdiAlertOutline
      );
    } finally {
      // A later name being saved still is.
      if (saving[index] === name) {
        saving[index] = undefined;
      }
    }
  }

  /**
   * @param {KeyboardEvent} event
   * @param {number} index
   */
  function handleKeyDown(event, index) {
    if (event.key === "Enter") {
      event.preventDefault();
      save(index);
    }
  }

  $: ({ profiles, walletKey } = $walletStore);
  // Every profile here, of every wallet, by the name it goes by, and the
  // open wallet's with its shielded address too: a contact saved with one of
  // a profile's own addresses takes nothing from its name.
  $: everyProfile = $profilesHere.map(({ address: account, name }) => ({
    account,
    address: String(
      profiles.find((profile) => String(profile.account) === account)
        ?.address ?? account
    ),
    name,
  }));
  $: follow(walletKey, profiles.length, $openProfileNames);

  // Each profile as the wallet shows it, without its name here: its number,
  // its `.dusk` name, and with more than one wallet, the wallet's name.
  $: lines = profiles.map((profile) =>
    [
      $openWalletName,
      profileLabel(profiles, profile, $networkStore.networkName),
    ]
      .filter(Boolean)
      .join(" · ")
  );
</script>

<article class="settings-group profile-names">
  <SectionHead>Profiles</SectionHead>
  <h3 class="profile-names__subtitle">Names on this device</h3>
  <ul class="profile-names__list">
    {#each profiles as profile, i (profile)}
      <li class="profile-names__profile">
        <span class="profile-names__line">
          <span class="profile-names__title">{lines[i]}</span>
          <span class="profile-names__account" title={String(profile.account)}
            >{shortenAddress(String(profile.account))}</span
          >
        </span>
        <Textbox
          aria-describedby={refused[i] ? `profile-name-error-${i}` : undefined}
          aria-invalid={refused[i] ? "true" : undefined}
          aria-label={`Profile ${i + 1} name`}
          autocomplete="off"
          bind:value={drafts[i]}
          className="profile-names__field"
          maxlength={NAME_LIMIT}
          on:blur={() => save(i)}
          on:input={() => {
            refused[i] = "";
          }}
          on:keydown={(event) => handleKeyDown(event, i)}
          placeholder="Name, only on this device"
          type="text"
        />
        {#if refused[i]}
          <p
            class="profile-names__error"
            id={`profile-name-error-${i}`}
            role="alert"
          >
            {refused[i]}
          </p>
        {/if}
        <FieldLimit limit={NAME_LIMIT} value={drafts[i] ?? ""} />
      </li>
    {/each}
  </ul>
</article>

<style lang="postcss">
  .profile-names__subtitle {
    color: var(--calm-muted);
    font-size: 0.875rem;
    font-weight: 400;
  }

  .profile-names__list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .profile-names__profile {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.625rem 0.875rem;
    border-radius: 0.875rem;
    background: var(--calm-s1);
  }

  .profile-names__line {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .profile-names__title,
  .profile-names__account {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-names__title {
    font-weight: 500;
  }

  .profile-names__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .profile-names__account {
    color: var(--calm-muted);
    font-family: var(--mono-font-family);
    font-size: 0.75rem;
  }
</style>
