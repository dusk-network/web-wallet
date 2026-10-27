<svelte:options immutable={true} />

<script>
  import { mdiArrowLeft } from "@mdi/js";

  import { Icon } from "$lib/dusk/components";
  import { addBasePath } from "$lib/navigation";

  /**
   * The card the Bridge and Migrate pages move DUSK with: From and To
   * panels with their networks, the amount and what arrives, the route in
   * one line that opens to its details, and one button. Its parts are
   * plain elements with these classes: `swap-panel` (with `swap-panel__head`,
   * `swap-panel__label`, `swap-amount`, `swap-token`, `swap-foot` and
   * `swap-error`), `swap-flip`, `swap-route` (a `<details>`), `swap-cta`
   * and `swap-lead`.
   */

  /** What the card is, for its region's name. */
  /** @type {string} */
  export let label;

  /** Where the back link goes, and what it says. */
  export let back = { href: "/dashboard", text: "Home" };
</script>

<div class="swap-page">
  <a class="swap-page__back" href={addBasePath(back.href)}
    ><Icon path={mdiArrowLeft} />{back.text}</a
  >
  <section aria-label={label} class="swap-card">
    <slot name="top" />
    <slot />
  </section>
  <slot name="after" />
</div>

<style lang="postcss">
  .swap-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
  }

  .swap-page__back {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: 0.375rem;
    width: min(100%, 30rem);
    min-height: 44px;
    color: var(--calm-muted);
    font-size: 0.875rem;
    text-decoration: none;

    &:hover {
      color: var(--calm-text);
    }

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
    }
  }

  .swap-card {
    display: flex;
    flex-direction: column;
    width: min(100%, 30rem);
    padding: 0.5rem 0.5rem 0.625rem;
    border-radius: 1.5rem;
    background: var(--calm-s1);
    box-shadow: 0 0 0 1px var(--calm-line);
  }

  .swap-card :global(.swap-top) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.125rem 0.125rem 0.5rem;
  }

  .swap-card :global(.swap-tabs) {
    display: flex;
    gap: 0.125rem;
  }

  .swap-card :global(.swap-tab) {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    padding: 0 0.875rem;
    border-radius: 999px;
    color: var(--calm-muted);
    font-size: 0.9375rem;
    font-weight: 500;
    text-decoration: none;
  }

  .swap-card :global(.swap-tab[aria-current="page"]) {
    background: var(--calm-s2);
    color: var(--calm-text);
  }

  .swap-card :global(.swap-tab:hover) {
    color: var(--calm-text);
  }

  .swap-card :global(.swap-lead) {
    margin: 0 0.5rem 0.625rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .swap-card :global(.swap-panel) {
    position: relative;
    padding: 0.875rem 1rem 0.75rem;
    border-radius: 1.125rem;
    background: var(--calm-field);
    box-shadow: inset 0 0 0 1px var(--calm-line);
  }

  .swap-card :global(.swap-panel:focus-within) {
    box-shadow: inset 0 0 0 1px var(--calm-line2);
  }

  .swap-card :global(.swap-panel__head) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    min-height: 2.75rem;
  }

  .swap-card :global(.swap-panel__label) {
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .swap-card :global(.swap-amount) {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .swap-card :global(.swap-amount input),
  .swap-card :global(.swap-amount output) {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--calm-text);
    font: inherit;
    font-size: 2.25rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    letter-spacing: -0.01em;
    outline: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swap-card :global(.swap-amount input::placeholder),
  .swap-card :global(.swap-amount output.swap-amount__empty) {
    color: var(--calm-subtle);
  }

  .swap-card :global(.swap-amount input:disabled) {
    color: var(--calm-subtle);
  }

  .swap-card :global(.swap-token) {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.4375rem;
    min-height: 2.25rem;
    padding: 0 0.875rem 0 0.25rem;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px var(--calm-line2);
    font-size: 0.9375rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .swap-card :global(.swap-foot) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.625rem;
    min-height: 1.375rem;
    margin: 0.5rem 0 0;
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .swap-card :global(.swap-foot__value) {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-variant-numeric: tabular-nums;
  }

  .swap-card :global(.swap-mini) {
    min-height: 1.75rem;
    padding: 0 0.625rem;
    border: 0;
    border-radius: 999px;
    background: var(--calm-s2);
    color: var(--calm-text);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
  }

  .swap-card :global(.swap-mini:disabled) {
    color: var(--calm-subtle);
    cursor: default;
  }

  .swap-card :global(.swap-link) {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .swap-card :global(.swap-error) {
    margin: 0.375rem 0 0;
    color: var(--calm-danger);
    font-size: 0.8125rem;
  }

  .swap-card :global(.swap-recipient) {
    margin: 0.25rem 0 0;
    color: var(--calm-muted);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }

  .swap-card :global(.swap-recipient b) {
    color: var(--calm-text);
    font-weight: 600;
  }

  .swap-card :global(.swap-flip) {
    position: relative;
    z-index: 2;
    height: 0.375rem;
  }

  .swap-card :global(.swap-flip > *) {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    margin: -1.375rem 0 0 -1.375rem;
    padding: 0;
    border: 0.3125rem solid var(--calm-s1);
    border-radius: 0.875rem;
    background: var(--calm-s2);
    color: var(--calm-text);
  }

  .swap-card :global(button.swap-flip__button) {
    cursor: pointer;
  }

  .swap-card :global(button.swap-flip__button:hover) {
    background: var(--calm-s3);
  }

  .swap-card :global(.swap-route) {
    margin: 0.375rem 0.125rem 0;
  }

  .swap-card :global(.swap-route > summary) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 0.5rem;
    border-radius: 0.625rem;
    color: var(--calm-muted);
    font-size: 0.84375rem;
    list-style: none;
    cursor: pointer;
  }

  .swap-card :global(.swap-route > summary::-webkit-details-marker) {
    display: none;
  }

  .swap-card :global(.swap-route > summary:hover) {
    color: var(--calm-text);
  }

  .swap-card :global(.swap-route > summary .dusk-icon) {
    flex: 0 0 auto;
    width: 1rem;
    height: 1rem;
  }

  .swap-card :global(.swap-route > summary .swap-route__chevron) {
    margin-left: auto;
    transition: transform 0.15s ease;
  }

  .swap-card :global(.swap-route[open] > summary .swap-route__chevron) {
    transform: rotate(180deg);
  }

  .swap-card :global(.swap-route dl) {
    display: flex;
    flex-direction: column;
    margin: 0 0.5rem;
  }

  .swap-card :global(.swap-route dl > div) {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--calm-line);
    font-size: 0.84375rem;
  }

  .swap-card :global(.swap-route dt) {
    color: var(--calm-muted);
  }

  .swap-card :global(.swap-route dd) {
    margin: 0;
    text-align: right;
  }

  .swap-card :global(.swap-route__note) {
    margin: 0.375rem 0.5rem 0.75rem;
    color: var(--calm-muted);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .swap-card :global(.swap-route__note b) {
    color: var(--calm-text);
  }

  .swap-card :global(.swap-cta) {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .swap-card :global(.swap-cta .dusk-button) {
    width: 100%;
    min-height: 3.375rem;
    font-size: 1rem;
  }

  @media (max-width: 40rem) {
    .swap-card :global(.swap-amount input),
    .swap-card :global(.swap-amount output) {
      font-size: 1.875rem;
    }
  }
</style>
