<svelte:options immutable={true} />

<script>
  /**
   * Check your recovery words: the password first, as for anything that
   * reads the phrase, then three of the open wallet's words, chosen at
   * random, typed as they were written down (RecoveryWordsCheck). The
   * phrase is read here alone, and forgotten as the page goes.
   */
  import { mdiArrowLeft } from "@mdi/js";
  import { onDestroy } from "svelte";

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
  {#if words.length}
    <RecoveryWordsCheck {words} />
  {:else}
    <form class="check-words__form" novalidate on:submit|preventDefault={open}>
      <UnlockPasswordField
        bind:error={passwordError}
        bind:value={password}
        disabled={busy}
      />
      {#if formError}
        <p class="check-words__error" role="alert">{formError}</p>
      {/if}
      <Button
        disabled={busy || !password}
        text={busy ? "Opening…" : "Continue"}
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
