<script>
  /**
   * Leave this payment?, asked over Send as a press would take it elsewhere
   * with a payment in it, as the extension asks: Stay is the main answer,
   * and has the focus, as Escape has; Leave clears it.
   */
  import { createEventDispatcher, onMount, tick } from "svelte";

  import { Button } from "$lib/dusk/components";
  import { randomUUID } from "$lib/dusk/string";

  /**
   * What leaving clears, in a sentence.
   *
   * @type {string}
   */
  export let text;

  const dispatch = createEventDispatcher();
  const id = randomUUID();

  /** @type {HTMLElement} */
  let dialog;

  /**
   * Escape stays wherever the focus is, and Tab stays in the dialog.
   *
   * @param {KeyboardEvent} event
   */
  function handleKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      dispatch("stay");
    } else if (event.key === "Tab") {
      const stops = /** @type {HTMLElement[]} */ (
        Array.from(dialog.querySelectorAll("button:not(:disabled)"))
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

    tick().then(() =>
      /** @type {HTMLElement | null} */ (
        dialog?.querySelector(".leave-payment__stay")
      )?.focus(),
    );

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="leave-payment__scrim" role="presentation"></div>
<div
  aria-describedby="{id}-text"
  aria-labelledby="{id}-title"
  aria-modal="true"
  bind:this={dialog}
  class="leave-payment"
  role="alertdialog"
  tabindex="-1"
>
  <h2 class="leave-payment__title" id="{id}-title">Leave this payment?</h2>
  <p class="leave-payment__text" id="{id}-text">{text}</p>
  <div class="leave-payment__actions">
    <Button
      className="leave-payment__leave"
      on:click={() => dispatch("leave")}
      text="Leave"
      variant="secondary"
    />
    <Button
      className="leave-payment__stay"
      on:click={() => dispatch("stay")}
      text="Stay"
      variant="primary"
    />
  </div>
</div>

<style lang="postcss">
  .leave-payment__scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: var(--calm-scrim);
  }

  .leave-payment {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 41;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    width: min(26rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 1.5rem;
    overflow-y: auto;
    border-radius: 1rem;
    background: var(--calm-s1);
    transform: translate(-50%, -50%);
  }

  .leave-payment__title {
    font-size: 1.125rem;
    font-weight: 500;
  }

  .leave-payment__text {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .leave-payment__actions {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 0.5rem;
  }
</style>
