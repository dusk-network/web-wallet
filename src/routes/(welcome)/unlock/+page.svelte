<svelte:options immutable={true} />

<script>
  import { mdiArrowLeft, mdiKeyOutline } from "@mdi/js";
  import { beforeNavigate } from "$app/navigation";
  import { onDestroy } from "svelte";

  import { getErrorFrom } from "$lib/dusk/error";
  import { Button, Textbox } from "$lib/dusk/components";
  import {
    InvalidMnemonicError,
    InvalidPasswordError,
    MismatchedWalletError,
  } from "$lib/errors";

  import { AppAnchor, AppAnchorButton, Banner } from "$lib/components";
  import { IconHeadingCard } from "$lib/containers/Cards";
  import { goto } from "$lib/navigation";
  import {
    mnemonicPhraseResetStore,
    settingsStore,
    walletStore,
  } from "$lib/stores";
  import {
    getSeedFromMnemonic,
    profileGeneratorFrom,
    validateMnemonic,
  } from "$lib/wallet";
  import vault from "$lib/vault";

  /** @type {(seed: Uint8Array<ArrayBuffer>) => Promise<ProfileGenerator>} */
  async function checkLocalData(seed) {
    controller.signal.throwIfAborted();
    const profileGenerator = await profileGeneratorFrom(seed);
    const defaultAddress = (await profileGenerator.default).address.toString();
    const currentAddress = $settingsStore.userId;

    if (!currentAddress || currentAddress !== defaultAddress) {
      throw new MismatchedWalletError();
    }

    return profileGenerator;
  }

  /** @type {(mnemonic: string) => Promise<Uint8Array<ArrayBuffer>>} */
  const getSeedFromMnemonicAsync = async (mnemonic) =>
    validateMnemonic(mnemonic)
      ? getSeedFromMnemonic(mnemonic)
      : Promise.reject(new InvalidMnemonicError());

  /**
   * The seed of the wallet this device has, of those the password opens in
   * the vault: v1's phrase moves into it as it opens. A wrong password is
   * an InvalidPasswordError.
   *
   * @type {(pwd: string) => Promise<Uint8Array<ArrayBuffer>>}
   */
  async function getSeedFromVault(pwd) {
    const { wallets } = await vault.unlock(pwd, { signal: controller.signal });
    const seeds = wallets.map(({ mnemonic }) => getSeedFromMnemonic(mnemonic));

    for (const seed of seeds) {
      const generator = await profileGeneratorFrom(seed);
      const address = (await generator.default).address.toString();

      if (address === $settingsStore.userId) {
        return seed;
      }
    }

    return seeds[0];
  }

  const hasPassword = vault.exists();
  const modeLabel = hasPassword ? "Password" : "Recovery phrase";

  /** @type {Textbox} */
  let fldSecret;

  /** @type {string} */
  let secretText = "";

  /** @type {Error} */
  let error;

  const controller = new AbortController();
  let pending = false;

  function cancelUnlock() {
    controller.abort();
    secretText = "";
    if (pending) {
      pending = false;
      walletStore.reset();
    }
  }

  beforeNavigate(cancelUnlock);
  onDestroy(cancelUnlock);

  /** @type {import("svelte/elements").FormEventHandler<HTMLFormElement>} */
  function handleUnlockWalletSubmit() {
    if (pending || controller.signal.aborted) {
      return;
    }
    pending = true;
    /** @type {(mnemonic: string) => Promise<Uint8Array<ArrayBuffer>>} */
    const getSeed = hasPassword
      ? getSeedFromVault
      : (mnemonic) => getSeedFromMnemonicAsync(mnemonic.toLowerCase());

    const secret = hasPassword ? secretText : secretText.trim();

    getSeed(secret)
      .then(checkLocalData)
      .then(async (profileGenerator) => {
        controller.signal.throwIfAborted();
        await walletStore.init(profileGenerator);
      })
      .then(() => {
        controller.signal.throwIfAborted();
        pending = false;
        return goto("/dashboard");
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        pending = false;
        if (err instanceof MismatchedWalletError) {
          const enteredMnemonicPhrase = secretText.split(" ");
          mnemonicPhraseResetStore.set(enteredMnemonicPhrase);
          goto("/setup/restore");
          return;
        }
        error = err instanceof Error ? err : getErrorFrom(err);
        fldSecret.focus();
        fldSecret.select();
      });
  }
</script>

<section class="login">
  <h2 class="h1">
    Unleash <mark>RWA</mark> and<br />
    <mark>Decentralized Finance</mark>
  </h2>
  <div class="login">
    <IconHeadingCard
      tag="article"
      gap="medium"
      heading={modeLabel}
      icons={[mdiKeyOutline]}
    >
      <form
        class="login__form"
        on:submit|preventDefault={handleUnlockWalletSubmit}
      >
        <Textbox
          bind:this={fldSecret}
          bind:value={secretText}
          name={modeLabel}
          aria-label={modeLabel}
          placeholder={modeLabel}
          required
          type="password"
          autocomplete="current-password"
          autofocus
        />
        {#if error instanceof InvalidMnemonicError}
          <Banner title="Invalid recovery phrase" variant="error">
            <p>
              Please ensure you have entered your 12-word recovery phrase, with
              a space separating each word.
            </p>
          </Banner>
        {:else if error instanceof InvalidPasswordError}
          <Banner title="Invalid password" variant="error">
            <p>
              Please ensure the password entered matches the one you have set up
              while setting up the wallet. If you have forgotten your password,
              you can <AppAnchor className="text-link" href="/setup/restore"
                >restore</AppAnchor
              > your wallet.
            </p>
          </Banner>
        {:else if error}
          <Banner
            title={error.name.replace(/(\w)([A-Z])/g, "$1 $2")}
            variant="error"
          >
            <p>{error.message}</p>
          </Banner>
        {/if}
        <Button text="Unlock Wallet" type="submit" disabled={pending} />
        {#if modeLabel === "Password"}
          <AppAnchorButton
            variant="tertiary"
            href="/setup/restore"
            text="Forgot Password?"
          />
        {/if}
      </form>
    </IconHeadingCard>
  </div>
  <footer class="login-footer">
    <AppAnchorButton
      href="/setup"
      variant="tertiary"
      icon={{ path: mdiArrowLeft }}
      text="Back"
    />
  </footer>
</section>

<style lang="postcss">
  .login,
  .login-footer,
  .login__form {
    display: flex;
    flex-direction: column;
  }

  .login {
    height: 100%;
    overflow-y: auto;
    gap: var(--large-gap);

    &__form {
      gap: var(--default-gap);
    }
  }

  .login-footer {
    gap: var(--default-gap);
  }

  :global(.alt-login) {
    width: 100%;
  }
</style>
