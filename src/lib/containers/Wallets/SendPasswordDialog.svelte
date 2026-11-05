<script>
  /**
   * Asks for the password on a send above the amount chosen in Settings, over
   * whatever shows: nothing of the send is made until it's given. Enter gives
   * it, Escape cancels, and what's typed goes with the dialog.
   */
  import { onMount, tick } from "svelte";

  import { Button } from "$lib/dusk/components";
  import { formatDuskExact } from "$lib/dusk/currency";
  import { randomUUID } from "$lib/dusk/string";
  import { UnlockPasswordField } from "$lib/components";
  import { InvalidPasswordError } from "$lib/errors";
  import { settingsStore } from "$lib/stores";

  /** @type {import("$lib/security/sendPassword").SendPasswordAsk} */
  export let ask;

  const id = randomUUID();

  /** @type {UnlockPasswordField} */
  let field;

  /** @type {HTMLElement} */
  let dialog;

  let password = "";
  let error = "";
  let busy = false;

  async function submit() {
    if (busy) {
      return;
    }

    if (!password) {
      error = "Enter your password.";

      return;
    }

    busy = true;
    error = "";

    try {
      await ask.answer(password);
    } catch (failure) {
      error =
        failure instanceof InvalidPasswordError
          ? "Wrong password."
          : "Couldn't check the password. Try again.";
    } finally {
      busy = false;
      password = "";
    }

    // The field takes the focus again once it's enabled again.
    await tick();
    field?.focus();
  }

  /**
   * Escape cancels wherever the focus is, and Tab stays in the dialog.
   *
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      ask.cancel();
    } else if (event.key === "Tab") {
      const stops = /** @type {HTMLElement[]} */ (
        Array.from(dialog.querySelectorAll("input, button:not(:disabled)"))
      );
      const last = stops.length - 1;
      const at = stops.indexOf(/** @type {HTMLElement} */ (event.target));

      if (event.shiftKey && at <= 0) {
        event.preventDefault();
        stops[last]?.focus();
      } else if (!event.shiftKey && at === last) {
        event.preventDefault();
        stops[0]?.focus();
      }
    }
  }

  onMount(() => {
    const opener = document.activeElement;

    tick().then(() => field?.focus());

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="send-password__scrim" role="presentation"></div>
<div
  aria-labelledby="{id}-title"
  aria-modal="true"
  bind:this={dialog}
  class="send-password"
  role="dialog"
  tabindex="-1"
>
  <form novalidate on:submit|preventDefault={submit}>
    <h2 class="send-password__title" id="{id}-title">Enter your password</h2>
    <p class="send-password__why">
      This is above the {formatDuskExact(ask.limit, $settingsStore.language)} DUSK
      you set in Settings.
    </p>
    <UnlockPasswordField
      bind:error
      bind:this={field}
      bind:value={password}
      disabled={busy}
    />
    <div class="send-password__actions">
      <Button
        disabled={busy}
        on:click={() => ask.cancel()}
        text="Cancel"
        variant="secondary"
      />
      <Button
        disabled={busy}
        text={busy ? "Checking…" : "Confirm"}
        type="submit"
        variant="primary"
      />
    </div>
  </form>
</div>

<style lang="postcss">
  .send-password__scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--calm-scrim);
  }

  .send-password {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 41;
    width: min(26rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 1.5rem;
    overflow-y: auto;
    border-radius: 1rem;
    background: var(--calm-s1);
    transform: translate(-50%, -50%);

    & form {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }
  }

  .send-password__title {
    font-size: 1.125rem;
    font-weight: 500;
  }

  .send-password__why {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .send-password__actions {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0.5rem;
  }
</style>
