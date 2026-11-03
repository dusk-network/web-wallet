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

  import {
    AppAnchor,
    AppAnchorButton,
    Banner,
    MnemonicInput,
  } from "$lib/components";
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
  import { unlockWallets, unlockWithoutPassword } from "$lib/wallets";

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
   * The wallet without a password: the one this device has, from its
   * recovery phrase.
   *
   * @param {string} mnemonic
   */
  const unlockWithPhrase = (mnemonic) =>
    getSeedFromMnemonicAsync(mnemonic.toLowerCase())
      .then(checkLocalData)
      .then(async (profileGenerator) => {
        controller.signal.throwIfAborted();
        await unlockWithoutPassword(profileGenerator, {
          signal: controller.signal,
        });
      });

  // One password unlocks every wallet in the vault; without one, the
  // recovery phrase unlocks the one wallet there is.
  const hasPassword = vault.exists();
  const modeLabel = hasPassword ? "Password" : "Recovery phrase";

  /** @type {Textbox} */
  let fldSecret;

  /** The password, or the phrase's words with a space between. */
  let secretText = "";

  /** Whether the word boxes hold a recovery phrase. */
  let isPhraseValid = false;

  /** What's wrong with the words, said under the boxes. */
  let phraseError = "";

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

  /** Unlocks with the password or the phrase given, once. */
  function handleUnlockWalletSubmit() {
    if (
      pending ||
      controller.signal.aborted ||
      (!hasPassword && !isPhraseValid)
    ) {
      return;
    }
    pending = true;

    const unlock = hasPassword
      ? unlockWallets(secretText, { signal: controller.signal })
      : unlockWithPhrase(secretText.trim());

    unlock
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
        if (err instanceof InvalidMnemonicError) {
          phraseError =
            "These words aren't a valid recovery phrase. Check each word.";
          return;
        }
        error = err instanceof Error ? err : getErrorFrom(err);
        fldSecret?.focus();
        fldSecret?.select();
      });
  }
</script>

<section class="login">
  <h2 class="h1">Unlock your wallet</h2>
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
        {#if hasPassword}
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
        {:else}
          <!-- A recovery phrase is no password: Restore's word boxes, which
            browsers offer no save for and keep no record of. -->
          <MnemonicInput
            bind:isValid={isPhraseValid}
            bind:mnemonic={secretText}
            error={phraseError}
            label={modeLabel}
            on:change={() => {
              phraseError = "";
            }}
            on:complete={handleUnlockWalletSubmit}
          />
        {/if}
        {#if error instanceof InvalidPasswordError}
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
        <Button
          text="Unlock Wallet"
          type="submit"
          disabled={pending || (!hasPassword && !isPhraseValid)}
        />
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
