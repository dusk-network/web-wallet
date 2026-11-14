<svelte:options immutable={true} />

<script>
  /**
   * Check your recovery words: the password first, as for anything that
   * reads the phrase, then three of the open wallet's words, chosen at
   * random, typed as they were written down (RecoveryWordsCheck). A check
   * that doesn't match shows no word: Show my recovery words, apart from it,
   * forgets the phrase and asks for the password again before it shows the
   * words, to write the paper again. The phrase is read here alone, and
   * forgotten as the page goes.
   */
  import { mdiArrowLeft } from "@mdi/js";
  import { onDestroy, tick } from "svelte";

  import { Button } from "$lib/dusk/components";
  import {
    AppAnchorButton,
    RecoveryWordsCheck,
    UnlockPasswordField,
  } from "$lib/components";
  import { InvalidPasswordError } from "$lib/errors";
  import { goto, pageTitle } from "$lib/navigation";
  import { walletStore } from "$lib/stores";
  import vault from "$lib/vault";

  import MnemonicPhrase from "../../../(welcome)/setup/create/MnemonicPhrase.svelte";

  /**
   * What the page asks for: the password to check the words, then the
   * check; after a check that didn't match, the password to show them, and
   * then the words.
   *
   * @type {"check" | "show"}
   */
  let purpose = "check";

  let password = "";

  let passwordError = "";

  let formError = "";

  let busy = false;

  /**
   * The open wallet's words, once the password opened it: none until then.
   *
   * @type {string[]}
   */
  let words = [];

  /** @type {UnlockPasswordField} */
  let passwordField;

  async function open() {
    passwordError = password ? "" : "Enter your password.";
    formError = "";

    if (busy || passwordError) {
      return;
    }

    busy = true;

    try {
      const { wallets } = await vault.unlock(password);
      const wallet = wallets.find(({ id }) => id === walletKey);

      password = "";

      if (wallet) {
        words = wallet.mnemonic.split(" ");
      } else {
        formError = "That password doesn't open this wallet.";
      }
    } catch (error) {
      if (error instanceof InvalidPasswordError) {
        passwordError = "Wrong password.";
      } else {
        formError = "Couldn't read your recovery words.";
      }
    } finally {
      busy = false;
    }
  }

  /**
   * Show my recovery words, after a check that didn't match: the phrase is
   * forgotten, and read again only with the password.
   */
  async function askToShow() {
    words = [];
    passwordError = "";
    formError = "";
    purpose = "show";
    await tick();
    passwordField?.focus();
  }

  // Nothing of the phrase or the password is kept once the page goes.
  onDestroy(() => {
    words = [];
    password = "";
  });

  // A wallet without a password keeps no phrase to check here.
  if (!vault.exists()) {
    goto("/settings");
  }

  $: ({ walletKey } = $walletStore);
</script>

<section class="check-words">
  <header class="check-words__header">
    <h1 use:pageTitle>Check your recovery words</h1>
  </header>
  {#if words.length && purpose === "show"}
    <MnemonicPhrase mnemonicPhrase={words} />
  {:else if words.length}
    <RecoveryWordsCheck on:show={askToShow} {words} />
  {:else}
    <form class="check-words__form" novalidate on:submit|preventDefault={open}>
      <UnlockPasswordField
        bind:this={passwordField}
        bind:error={passwordError}
        bind:value={password}
        disabled={busy}
      />
      {#if formError}
        <p class="check-words__error" role="alert">{formError}</p>
      {/if}
      <Button
        disabled={busy || !password}
        text={busy
          ? "Opening…"
          : purpose === "show"
            ? "Show my recovery words"
            : "Continue"}
        type="submit"
      />
    </form>
  {/if}
  <div class="check-words__actions">
    <AppAnchorButton
      disabled={busy}
      href="/settings"
      icon={{ path: mdiArrowLeft }}
      text="Back"
      variant="tertiary"
    />
  </div>
</section>

<style lang="postcss">
  .check-words {
    display: flex;
    flex-direction: column;
    gap: var(--default-gap);
    width: min(100%, 44rem);
    margin: 0 auto;
    padding: 2rem 1.5rem 3rem;

    &__header h1 {
      font-size: 1.75rem;
      font-weight: 500;
      line-height: 1.15;
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
  }

  @media (max-width: 47.99rem) {
    .check-words {
      padding: 1rem 1rem 2rem;

      &__header h1 {
        font-size: 1.375rem;
      }
    }
  }
</style>
