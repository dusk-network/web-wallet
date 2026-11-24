<svelte:options immutable={true} />

<script>
  /**
   * Hold to show words, a button as the wallet's others look, for a phone
   * (touchOnly): `held` while it's held, and only then (holdToShow). Its long
   * press is the hold, never the browser's menu or a selection. Words taller
   * than the screen don't take it out of reach: it's held at the foot of the
   * screen while words above it show, above what else is stuck there.
   */
  import { onMount } from "svelte";

  import { makeClassName } from "$lib/dusk/string";
  import holdToShow, { HOLD_TO_SHOW_TEXT } from "$lib/security/holdToShow";

  /** Whether it's held now. */
  export let held = false;

  /**
   * The ID of what holds the words it shows: the focus can go there while
   * they show, and nowhere else (holdToShow).
   *
   * @type {string | undefined}
   */
  export let controls = undefined;

  /** @type {string | undefined} */
  export let className = undefined;

  /** @param {boolean} isHeld */
  const hold = (isHeld) => {
    held = isHeld;
  };

  /** @type {HTMLButtonElement} */
  let button;

  /**
   * What's stuck at the foot of the window there, in pixels, for it to stay
   * above: its flow's buttons (the wizard's) and a phone's tab bar.
   */
  let foot = 0;

  onMount(() => {
    const stuck = [
      button
        .closest(".dusk-wizard")
        ?.querySelector(".dusk-wizard__step-navigation"),
      document.querySelector(".tab-bar"),
    ].filter((each) => each instanceof HTMLElement);

    const measure = () => {
      foot = Math.max(
        0,
        ...stuck.map((each) => {
          const { bottom, display, position } = getComputedStyle(each);

          return display !== "none" &&
            (position === "sticky" || position === "fixed")
            ? each.offsetHeight + (Number.parseFloat(bottom) || 0)
            : 0;
        }),
      );
    };
    // As a keyboard comes or goes, once its inset is said.
    const measureLater = () => requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);

    measure();
    stuck.forEach((each) => observer.observe(each));
    addEventListener("resize", measureLater);
    globalThis.visualViewport?.addEventListener("resize", measureLater);

    return () => {
      observer.disconnect();
      removeEventListener("resize", measureLater);
      globalThis.visualViewport?.removeEventListener("resize", measureLater);
    };
  });
</script>

<button
  bind:this={button}
  aria-controls={controls}
  aria-pressed={held}
  class={makeClassName([
    "dusk-button",
    "dusk-button--type--button",
    "dusk-button--variant--secondary",
    "dusk-button--size--default",
    "hold-to-show",
    className,
  ])}
  style:bottom={foot ? `calc(${foot}px + var(--small-gap))` : undefined}
  type="button"
  use:holdToShow={hold}
>
  <span class="dusk-button__text">{HOLD_TO_SHOW_TEXT}</span>
</button>

<style lang="postcss">
  .hold-to-show {
    /* In reach wherever the words are scrolled to: at the foot of the screen
       while words above it show, in its place once that shows. A held finger
       can't scroll, and a second touch ends the hold. Above what else is
       stuck there, as it's measured. */
    position: sticky;
    bottom: var(--small-gap);
    z-index: 1;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
</style>
