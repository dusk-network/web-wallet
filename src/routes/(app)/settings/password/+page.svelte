<svelte:options immutable={true} />

<script>
  /**
   * Change password: the current one, then the new one twice. Every
   * recovery phrase here is sealed again with the new one, and the other
   * tabs lock: they unlock with the new one.
   */
  import { mdiArrowLeft, mdiCheck } from "@mdi/js";

  import { Button, Textbox } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { randomUUID } from "$lib/dusk/string";
  import { AppAnchorButton } from "$lib/components";
  import { InvalidPasswordError } from "$lib/errors";
  import { goto, pageTitle } from "$lib/navigation";
  import vault from "$lib/vault";
  import { getPasswordStrength } from "$lib/wallet";
  import { changeWalletPassword } from "$lib/wallets";

  const id = randomUUID();

  /** @type {Record<ReturnType<typeof getPasswordStrength>, string>} */
  const strengthHints = {
    fair: "Fair password. Longer is safer.",
    strong: "Strong password.",
    weak: "Weak password: easy to guess. Make it longer, or use a few unrelated words.",
  };

  let current = "";

  let next = "";

  let again = "";

  let currentError = "";

  let nextError = "";

  let againError = "";

  let formError = "";

  let busy = false;

  /** What's wrong with the fields, said under the one it's about: false for nothing. */
  function isWrong() {
    currentError = current ? "" : "Enter your password.";
    nextError = current && next.length < 8 ? "Use at least 8 characters." : "";
    againError =
      current && !nextError && next !== again
        ? "The passwords don't match."
        : "";

    return Boolean(currentError || nextError || againError);
  }

  /** @param {unknown} error */
  function refused(error) {
    busy = false;

    if (error instanceof InvalidPasswordError) {
      currentError = "Wrong password.";
    } else {
      formError =
        error instanceof Error
          ? error.message
          : "Couldn't change the password.";
    }
  }

  async function change() {
    formError = "";

    if (busy || isWrong()) {
      return;
    }

    busy = true;

    try {
      await changeWalletPassword(current, next);
      current = "";
      next = "";
      again = "";
      toast("success", "Password changed.", mdiCheck);
      await goto("/settings");
    } catch (error) {
      refused(error);
    }
  }

  // A wallet without a password has none to change.
  if (!vault.exists()) {
    goto("/settings");
  }

  $: strength = next.length >= 8 ? getPasswordStrength(next) : null;
</script>

<section class="change-password">
  <header class="change-password__header">
    <h1 use:pageTitle>Change password</h1>
    <p class="change-password__lead">
      Every wallet in this browser then opens with the new password. Your
      recovery phrases stay the same.
    </p>
  </header>
  <form
    class="change-password__form"
    novalidate
    on:submit|preventDefault={change}
  >
    <div class="change-password__field">
      <label for="{id}-current">Current password</label>
      <Textbox
        aria-describedby={currentError ? `${id}-current-error` : undefined}
        aria-invalid={currentError ? "true" : undefined}
        autocomplete="current-password"
        bind:value={current}
        disabled={busy}
        id="{id}-current"
        on:input={() => {
          currentError = "";
        }}
        type="password"
      />
      {#if currentError}
        <p class="change-password__error" id="{id}-current-error" role="alert">
          {currentError}
        </p>
      {/if}
    </div>
    <div class="change-password__field">
      <label for="{id}-next">New password</label>
      <Textbox
        aria-describedby={nextError
          ? `${id}-next-error`
          : strength
            ? `${id}-strength`
            : undefined}
        aria-invalid={nextError ? "true" : undefined}
        autocomplete="new-password"
        bind:value={next}
        disabled={busy}
        id="{id}-next"
        on:input={() => {
          nextError = "";
        }}
        placeholder="At least 8 characters"
        type="password"
      />
      {#if nextError}
        <p class="change-password__error" id="{id}-next-error" role="alert">
          {nextError}
        </p>
      {:else if strength}
        <p
          class="change-password__hint"
          class:change-password__hint--weak={strength === "weak"}
          id="{id}-strength"
        >
          {strengthHints[strength]}
        </p>
      {/if}
    </div>
    <div class="change-password__field">
      <label for="{id}-again">Confirm password</label>
      <Textbox
        aria-describedby={againError ? `${id}-again-error` : undefined}
        aria-invalid={againError ? "true" : undefined}
        autocomplete="new-password"
        bind:value={again}
        disabled={busy}
        id="{id}-again"
        on:input={() => {
          againError = "";
        }}
        placeholder="The same password again"
        type="password"
      />
      {#if againError}
        <p class="change-password__error" id="{id}-again-error" role="alert">
          {againError}
        </p>
      {/if}
    </div>
    {#if formError}
      <p class="change-password__error" role="alert">{formError}</p>
    {/if}
    <Button
      disabled={busy}
      text={busy ? "Changing…" : "Change password"}
      type="submit"
      variant="primary"
    />
  </form>
  <p class="change-password__note">
    Your other open tabs lock. Unlock them with the new password.
  </p>
  <div class="change-password__actions">
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
  .change-password {
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

    &__lead,
    &__note {
      color: var(--calm-muted);
    }

    &__note {
      font-size: 0.875rem;
    }

    &__form {
      display: flex;
      flex-direction: column;
      gap: var(--default-gap);
    }

    &__field {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;

      & label {
        font-size: 0.875rem;
        font-weight: 500;
      }
    }

    &__error {
      color: var(--calm-danger);
      font-size: 0.875rem;
      line-height: 1.4;
    }

    &__hint {
      color: var(--calm-muted);
      font-size: 0.8125rem;

      &--weak {
        color: var(--calm-pending);
      }
    }
  }

  @media (max-width: 47.99rem) {
    .change-password {
      padding: 1rem 1rem 2rem;

      &__header h1 {
        font-size: 1.375rem;
      }
    }
  }
</style>
