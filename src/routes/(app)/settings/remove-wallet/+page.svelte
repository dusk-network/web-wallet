<svelte:options immutable={true} />

<script>
  /**
   * Remove wallet, as Settings chose it (`?wallet=`, its vault ID): what
   * goes, and the password. The other wallets stay as they are. A wallet
   * that went meanwhile, here or in another tab, or the only one, is for
   * Settings.
   */
  import { mdiArrowLeft, mdiCheck } from "@mdi/js";
  import { page } from "$app/stores";

  import { Button } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { shortenAddress } from "$lib/dusk/string";
  import { AppAnchorButton, UnlockPasswordField } from "$lib/components";
  import { InvalidPasswordError } from "$lib/errors";
  import { goto, pageTitle } from "$lib/navigation";
  import { walletStore } from "$lib/stores";
  import { removeWallet, walletDirectory, walletLabel } from "$lib/wallets";

  let password = "";

  let passwordError = "";

  let formError = "";

  let busy = false;

  /** @param {unknown} error */
  function refused(error) {
    busy = false;

    if (error instanceof InvalidPasswordError) {
      passwordError = "Wrong password.";
    } else {
      formError =
        error instanceof Error ? error.message : "Couldn't remove the wallet.";
    }
  }

  async function remove() {
    passwordError = password ? "" : "Enter your password.";
    formError = "";

    if (busy || !wallet || passwordError) {
      return;
    }

    const { key, label } = wallet;

    busy = true;

    try {
      await removeWallet(key, password);
      password = "";
      toast("success", `${label} removed.`, mdiCheck);
      await goto("/settings");
    } catch (error) {
      refused(error);
    }
  }

  $: ({ profiles, walletKey, wallets } = $walletStore);
  $: key = $page.url.searchParams.get("wallet") ?? "";
  $: held = wallets.find((w) => w.key === key);
  $: wallet =
    held && wallets.length > 1
      ? {
          account:
            key === walletKey
              ? String(profiles[0]?.account ?? "")
              : ($walletDirectory.wallets[key]?.walletId ?? ""),
          key,
          label: walletLabel({
            n: held.n,
            name: $walletDirectory.wallets[key]?.name,
          }),
        }
      : null;

  // Gone meanwhile, or the only one: Settings, unless this page removes it.
  $: if (!wallet && !busy) {
    goto("/settings");
  }
</script>

{#if wallet}
  <section class="remove-wallet">
    <header class="remove-wallet__header">
      <h1 use:pageTitle>Remove wallet</h1>
      <!-- Which wallet, by its first profile's account too: names can be
        alike. -->
      <p class="remove-wallet__which">
        {wallet.label}{#if wallet.account}<span class="remove-wallet__account"
            >{` · ${shortenAddress(wallet.account)}`}</span
          >{/if}
      </p>
    </header>
    <p>
      This removes {wallet.label} from this device: its recovery phrase, contacts
      and activity. Your other wallets stay as they are.
    </p>
    <p class="remove-wallet__note">
      Your funds stay on Dusk. The recovery phrase brings this wallet back.
    </p>
    <form
      class="remove-wallet__form"
      novalidate
      on:submit|preventDefault={remove}
    >
      <UnlockPasswordField
        bind:error={passwordError}
        bind:value={password}
        disabled={busy}
      />
      {#if formError}
        <p class="remove-wallet__error" role="alert">{formError}</p>
      {/if}
      <Button
        className="remove-wallet__button"
        disabled={busy}
        text={busy ? "Removing…" : "Remove wallet"}
        type="submit"
      />
    </form>
    <div class="remove-wallet__actions">
      <AppAnchorButton
        disabled={busy}
        href="/settings"
        icon={{ path: mdiArrowLeft }}
        text="Back"
        variant="tertiary"
      />
    </div>
  </section>
{/if}

<style lang="postcss">
  .remove-wallet {
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    width: min(100%, 44rem);
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;

    &__header {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      & h1 {
        font-size: 1.75rem;
        font-weight: 500;
        line-height: 1.15;
      }
    }

    &__which {
      font-weight: 500;
    }

    &__account {
      color: var(--calm-muted);
      font-family: var(--mono-font-family);
      font-size: 0.875rem;
      font-weight: 400;
    }

    &__note {
      color: var(--calm-muted);
      font-size: 0.875rem;
    }

    &__form {
      display: flex;
      flex-direction: column;
      gap: var(--default-gap);
    }

    &__error {
      color: var(--calm-danger);
      font-size: 0.875rem;
      line-height: 1.4;
    }

    & :global(.remove-wallet__button) {
      background-color: var(--status-error-bg-color);
      border-color: var(--badge-error-color);
      color: var(--badge-error-color);
    }
  }

  @media (max-width: 47.99rem) {
    .remove-wallet {
      padding: 1rem 1rem 2rem;

      &__header h1 {
        font-size: 1.375rem;
      }
    }
  }
</style>
