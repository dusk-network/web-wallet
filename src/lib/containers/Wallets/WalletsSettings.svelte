<script>
  /**
   * Settings › Wallets: the wallets here, each by its name only this device
   * knows, as the switcher shows them, with Rename and, while there's
   * another, Remove; then Add wallet and Change password, which take the
   * password the wallets share. Rename opens a field for the name, with
   * Save and Cancel (Enter and Escape).
   */
  import { mdiAlertOutline, mdiCheck, mdiPlus } from "@mdi/js";
  import { tick } from "svelte";

  import { Button, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { shortenAddress } from "$lib/dusk/string";
  import { AppAnchorButton, SectionHead } from "$lib/components";
  import { walletStore } from "$lib/stores";
  import vault from "$lib/vault";
  import {
    normalizeWalletName,
    renameWallet,
    walletDirectory,
    walletLabel,
  } from "$lib/wallets";

  // Adding a wallet and a new password take the password the wallets share.
  const hasPassword = vault.exists();

  /**
   * The wallet being renamed: null for none.
   *
   * @type {string | null}
   */
  let renaming = null;

  /** The name typed for it so far. */
  let draft = "";

  let saving = false;

  /** @param {string} key */
  async function startRenaming(key) {
    renaming = key;
    draft = normalizeWalletName($walletDirectory.wallets[key]?.name);
    await tick();
    document.getElementById(`wallet-name-${key}`)?.focus();
  }

  async function stopRenaming() {
    const key = renaming;

    renaming = null;
    draft = "";
    saving = false;
    await tick();
    document.getElementById(`wallet-rename-${key}`)?.focus();
  }

  async function save() {
    if (renaming === null || saving) {
      return;
    }

    const key = renaming;
    const name = normalizeWalletName(draft);

    saving = true;

    try {
      if (name !== normalizeWalletName($walletDirectory.wallets[key]?.name)) {
        await renameWallet(key, name);
        toast("success", "Name saved.", mdiCheck);
      }

      await stopRenaming();
    } catch {
      saving = false;
      toast("error", "Couldn't save the name.", mdiAlertOutline);
    }
  }

  /** @param {KeyboardEvent} event */
  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopRenaming();
    }
  }

  $: ({ profiles, walletKey, wallets } = $walletStore);

  // Each wallet by its name, with its first profile's account: names can
  // be alike.
  $: rows = wallets.map(({ key, n }) => {
    const kept = $walletDirectory.wallets[key];

    return {
      account:
        key === walletKey
          ? String(profiles[0]?.account ?? "")
          : (kept?.walletId ?? ""),
      key,
      label: walletLabel({ n, name: kept?.name }),
      n,
    };
  });

  // A renamed wallet that went meanwhile, here or in another tab: no field.
  $: if (renaming !== null && !wallets.some(({ key }) => key === renaming)) {
    renaming = null;
    draft = "";
  }
</script>

<article class="settings-group wallets-settings">
  <SectionHead>Wallets</SectionHead>
  <ul class="wallets-settings__list">
    {#each rows as row (row.key)}
      <li class="wallets-settings__wallet">
        {#if renaming === row.key}
          <label class="wallets-settings__label" for="wallet-name-{row.key}"
            >Name</label
          >
          <div class="wallets-settings__edit">
            <Textbox
              aria-describedby="wallet-name-hint-{row.key}"
              bind:value={draft}
              className="wallets-settings__field"
              id="wallet-name-{row.key}"
              maxlength={32}
              on:keydown={handleKeyDown}
              placeholder={`Wallet ${row.n}`}
              type="text"
            />
            <Button
              aria-label={`Save ${row.label}'s name`}
              disabled={saving}
              on:click={save}
              text="Save"
              variant="secondary"
            />
            <Button
              disabled={saving}
              on:click={stopRenaming}
              text="Cancel"
              variant="tertiary"
            />
          </div>
          <p class="wallets-settings__hint" id="wallet-name-hint-{row.key}">
            Only on this device.
          </p>
        {:else}
          <div class="wallets-settings__head">
            <span class="wallets-settings__name">
              <span class="wallets-settings__title">{row.label}</span>
              {#if row.account}
                <span class="wallets-settings__account" title={row.account}
                  >{shortenAddress(row.account)}</span
                >
              {/if}
            </span>
            <span class="wallets-settings__actions">
              <Button
                aria-label={`Rename ${row.label}`}
                id="wallet-rename-{row.key}"
                on:click={() => startRenaming(row.key)}
                text="Rename"
                variant="tertiary"
              />
              {#if rows.length > 1}
                <AppAnchorButton
                  aria-label={`Remove ${row.label}`}
                  href={`/settings/remove-wallet?wallet=${row.key}`}
                  text="Remove"
                  variant="tertiary"
                />
              {/if}
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if hasPassword}
    <div class="wallets-settings__more">
      <AppAnchorButton
        href="/wallets/add"
        icon={{ path: mdiPlus }}
        text="Add wallet"
        variant="tertiary"
      />
      <AppAnchorButton
        href="/settings/password"
        text="Change password"
        variant="tertiary"
      />
    </div>
    <p class="settings-group__note">
      Changes the password for every wallet here.
    </p>
  {:else}
    <p class="settings-group__note">
      Adding a wallet needs a password. Restore this wallet with one first.
    </p>
  {/if}
</article>

<style lang="postcss">
  .wallets-settings__list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .wallets-settings__wallet {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.625rem 0.875rem;
    border-radius: 0.875rem;
    background: var(--calm-s1);
  }

  .wallets-settings__head,
  .wallets-settings__edit {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .wallets-settings__name {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .wallets-settings__title,
  .wallets-settings__account {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wallets-settings__title {
    font-weight: 500;
  }

  .wallets-settings__account {
    color: var(--calm-muted);
    font-family: var(--mono-font-family);
    font-size: 0.75rem;
  }

  .wallets-settings__actions {
    display: flex;
    flex: 0 0 auto;
    gap: 0.25rem;
  }

  .wallets-settings__label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .wallets-settings__edit :global(.wallets-settings__field) {
    flex: 1;
    min-width: 0;
  }

  .wallets-settings__hint {
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .wallets-settings__more {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
