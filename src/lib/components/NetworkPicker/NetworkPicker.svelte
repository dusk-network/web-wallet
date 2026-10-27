<svelte:options immutable={true} />

<script>
  import { createEventDispatcher, tick } from "svelte";
  import { mdiCheck, mdiChevronDown } from "@mdi/js";

  import { Icon } from "$lib/dusk/components";

  import NetworkMark from "./NetworkMark.svelte";

  /**
   * @typedef {{ disabled?: string, id: string, name: string, note?: string }} NetworkChoice
   *   `disabled` says why it can't be picked.
   */

  /** What the picker is for, as "From" or "To". */
  /** @type {string} */
  export let side;

  /** @type {string} */
  export let value;

  /** @type {NetworkChoice[]} */
  export let choices;

  /** What the list is titled, as "Where it goes". */
  /** @type {string} */
  export let title;

  /** Whether the network can't be changed now. */
  export let disabled = false;

  const dispatch = createEventDispatcher();

  let isOpen = false;

  /** @type {HTMLButtonElement} */
  let button;

  /** @type {HTMLDivElement} */
  let list;

  async function open() {
    isOpen = true;
    await tick();
    /** @type {HTMLElement | null} */ (
      list?.querySelector('[aria-selected="true"]') ??
        list?.querySelector("button")
    )?.focus();
  }

  function close() {
    isOpen = false;
    button?.focus();
  }

  /** @param {NetworkChoice} choice */
  function pick(choice) {
    if (choice.disabled) {
      return;
    }

    close();

    if (choice.id !== value) {
      dispatch("pick", choice.id);
    }
  }

  /** @param {KeyboardEvent} event */
  function keydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();

    const options = Array.from(list.querySelectorAll("button"));
    const at = options.indexOf(
      /** @type {HTMLButtonElement} */ (document.activeElement)
    );
    const step = event.key === "ArrowDown" ? 1 : -1;

    options[(at + step + options.length) % options.length]?.focus();
  }

  /** @param {FocusEvent} event */
  function focusout(event) {
    const next = /** @type {Node | null} */ (event.relatedTarget);

    if (isOpen && next && !list?.contains(next) && next !== button) {
      isOpen = false;
    }
  }

  $: current = choices.find((choice) => choice.id === value);
</script>

<div class="network-picker" on:focusout={focusout}>
  <button
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-label={`${side}: ${current?.name ?? ""}. Choose the network`}
    bind:this={button}
    class="network-picker__button"
    data-side={side.toLowerCase()}
    data-value={value}
    {disabled}
    on:click={() => (isOpen ? close() : open())}
    type="button"
  >
    <NetworkMark id={value} />
    <span>{current?.name ?? ""}</span>
    <Icon path={mdiChevronDown} size="small" />
  </button>
  {#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="network-picker__scrim" on:click={close}></div>
    <div
      aria-label={title}
      bind:this={list}
      class="network-picker__list"
      on:keydown={keydown}
      role="listbox"
      tabindex="-1"
    >
      <p class="network-picker__title">{title}</p>
      {#each choices as choice (choice.id)}
        <button
          aria-disabled={choice.disabled ? "true" : undefined}
          aria-selected={choice.id === value}
          class="network-picker__option"
          on:click={() => pick(choice)}
          role="option"
          type="button"
        >
          <NetworkMark id={choice.id} />
          <span class="network-picker__text">
            <span class="network-picker__name">{choice.name}</span>
            {#if choice.disabled || choice.note}
              <span class="network-picker__note"
                >{choice.disabled ?? choice.note}</span
              >
            {/if}
          </span>
          {#if choice.id === value}
            <Icon path={mdiCheck} size="small" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style lang="postcss">
  .network-picker {
    position: relative;
  }

  .network-picker__button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 0.75rem 0 0.375rem;
    border: 0;
    border-radius: 999px;
    background: var(--calm-s2);
    color: var(--calm-text);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--calm-s3);
    }

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }

    & :global(.dusk-icon) {
      color: var(--calm-muted);
    }
  }

  .network-picker__scrim {
    position: fixed;
    inset: 0;
    z-index: 20;
  }

  .network-picker__list {
    position: absolute;
    top: calc(100% + 0.375rem);
    right: 0;
    z-index: 21;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    width: min(18rem, calc(100vw - 2rem));
    padding: 0.5rem;
    border-radius: 1rem;
    background: var(--calm-panel);
    box-shadow:
      0 0 0 1px var(--calm-line2),
      0 12px 32px rgb(0 0 0 / 0.18);
  }

  .network-picker__title {
    margin: 0.25rem 0.5rem 0.375rem;
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .network-picker__option {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.75rem;
    padding: 0.5rem;
    border: 0;
    border-radius: 0.75rem;
    background: transparent;
    color: var(--calm-text);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--calm-s2);
    }

    &[aria-disabled="true"] {
      color: var(--calm-subtle);
      cursor: default;
    }

    & > :global(.dusk-icon) {
      margin-left: auto;
    }
  }

  .network-picker__text {
    display: flex;
    flex-direction: column;
  }

  .network-picker__name {
    font-weight: 500;
  }

  .network-picker__note {
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }
</style>
