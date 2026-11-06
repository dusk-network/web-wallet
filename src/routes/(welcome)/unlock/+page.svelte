<svelte:options immutable={true} />

<script>
  import { mdiArrowLeft, mdiFingerprint, mdiKeyOutline } from "@mdi/js";
  import { beforeNavigate } from "$app/navigation";
  import { onDestroy, onMount } from "svelte";

  import { getErrorFrom } from "$lib/dusk/error";
  import { Button, Textbox } from "$lib/dusk/components";
  import {
    InvalidMnemonicError,
    InvalidPasswordError,
    MismatchedWalletError,
    PasskeyGoneError,
  } from "$lib/errors";

  import {
    AppAnchor,
    AppAnchorButton,
    Banner,
    MnemonicInput,
  } from "$lib/components";
  import { IconHeadingCard } from "$lib/containers/Cards";

  import PaymentAsked from "../PaymentAsked.svelte";
  import { goto, lockedHere, takePlace } from "$lib/navigation";
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
  import {
    unlockWallets,
    unlockWithPasskey,
    unlockWithoutPassword,
  } from "$lib/wallets";

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

  /** @type {Error | null} */
  let error = null;

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

  /** Whether fingerprint or face unlock is on here. */
  let hasPasskey = hasPassword && Boolean(vault.passkey());

  /** What's to say of fingerprint or face unlock, after trying it. */
  let passkeyProblem = "";

  /** Whether they turned it down: it's for them to ask for again, from here. */
  let isDeclined = false;

  /**
   * Unlocks with fingerprint or face. One that wasn't pressed for, as the wallet
   * opens, says nothing of being cancelled or refused: the password is there.
   *
   * @param {boolean} [asked] Whether it was pressed for
   */
  function unlockByPasskey(asked = false) {
    if (pending || controller.signal.aborted) {
      return;
    }

    pending = true;
    passkeyProblem = "";
    unlockWithPasskey({ signal: controller.signal })
      .then(() => {
        controller.signal.throwIfAborted();
        pending = false;

        return goto(takePlace() ?? "/dashboard", { replaceState: true });
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }

        pending = false;
        isDeclined = true;

        // The password takes the focus, and a phone's keyboard comes up, only
        // once it's the one way in: the fingerprint is still there to try.
        if (err instanceof PasskeyGoneError) {
          hasPasskey = false;
          passkeyProblem =
            "Fingerprint or face unlock is off now. Use your password, and turn it on again in Settings.";
          fldSecret?.focus();
        } else if (asked) {
          passkeyProblem =
            "That didn't unlock the wallet. Try again, or use your password.";
        }
      });
  }

  /** Goes straight to it, for someone here: never a prompt for no one. */
  function askIfHere() {
    if (
      hasPasskey &&
      !isDeclined &&
      !secretText &&
      document.visibilityState === "visible" &&
      document.hasFocus()
    ) {
      unlockByPasskey();
    }
  }

  /** Asked again as the tab comes back, as after it locked by itself. */
  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      askIfHere();
    }
  }

  onMount(() => {
    // As the wallet opens, or reloads: not the moment it locks.
    if (!lockedHere()) {
      askIfHere();
    }
  });

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

    // Gone until this try's answer: an alert that's said again is announced.
    error = null;

    unlock
      .then(() => {
        controller.signal.throwIfAborted();
        pending = false;
        // Where a lock, a reload or a link left off.
        // In this page's place: Back from there isn't a password to give.
        return goto(takePlace() ?? "/dashboard", { replaceState: true });
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

<svelte:document on:visibilitychange={handleVisibilityChange} />

<section class="login">
  <h2 class="h1">Unlock your wallet</h2>
  <PaymentAsked next="Unlock to pay it." />
  <div class="login">
    {#if hasPasskey}
      <Button
        disabled={pending}
        icon={{ path: mdiFingerprint }}
        on:click={() => unlockByPasskey(true)}
        text="Use fingerprint or face"
        variant="primary"
      />
    {/if}
    {#if passkeyProblem}
      <Banner role="alert" title={passkeyProblem} variant="warning" />
    {/if}
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
            aria-invalid={error instanceof InvalidPasswordError}
            placeholder={modeLabel}
            required
            type="password"
            autocomplete="current-password"
            autofocus={!hasPasskey}
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
          <Banner role="alert" title="Wrong password." variant="error">
            <p>
              Forgot it? <AppAnchor className="text-link" href="/setup/restore"
                >Restore with your recovery phrase</AppAnchor
              >.
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
          text="Unlock wallet"
          type="submit"
          disabled={pending || (!hasPassword && !isPhraseValid)}
          variant={hasPasskey ? "secondary" : "primary"}
        />
        {#if modeLabel === "Password"}
          <AppAnchorButton
            variant="tertiary"
            href="/setup/restore"
            text="Forgot password?"
          />
        {/if}
      </form>
    </IconHeadingCard>
  </div>
  <footer class="login-footer">
    <AppAnchorButton
      href={hasPasskey ? "/setup?choose" : "/setup"}
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
