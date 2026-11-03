<svelte:options immutable={true} />

<script>
  import { CONFIRM_DELAY } from "$lib/dusk/motion";
  import { makeClassName } from "$lib/dusk/string";

  import Icon from "../Icon/Icon.svelte";

  /** @type {Boolean} */
  export let active = false;

  /** @type {String | Undefined} */
  export let className = undefined;

  /**
   * Whether it sends, stakes, signs or approves: for a moment after it
   * shows, it ignores clicks and Enter, and looks as always meanwhile, so
   * a double click on the button before it can't land on it.
   *
   * @type {Boolean}
   */
  export let confirm = false;

  /** @type {IconProp | Undefined} */
  export let icon = undefined;

  /** @type {ButtonSize} */
  export let size = "default";

  /** @type {ButtonVariant} */
  export let variant = "primary";

  /** @type {String | Undefined} */
  export let text = undefined;

  /** @type {"button" | "reset" | "submit" | "toggle"} */
  export let type = "button";

  const shownAt = performance.now();

  /**
   * Stops a click, or Enter, that comes too soon after a confirm shows,
   * before anything else hears it.
   *
   * @param {MouseEvent} event
   */
  function holdTooSoon(event) {
    if (confirm && performance.now() - shownAt < CONFIRM_DELAY) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  $: classes = makeClassName([
    "dusk-button",
    `dusk-button--type--${type}`,
    `dusk-button--variant--${variant}`,
    `dusk-button--size--${size}`,
    icon && text ? "dusk-icon-button--labeled" : icon ? "dusk-icon-button" : "",
    type === "toggle" && active ? "dusk-button--active" : "",
    className,
  ]);
</script>

<button
  {...$$restProps}
  aria-pressed={type === "toggle" ? active : undefined}
  class={classes}
  on:click|capture={holdTooSoon}
  on:click
  on:mousedown
  on:mouseup
  type={type === "toggle" ? "button" : type}
>
  {#if icon?.position === "after"}
    {#if text}
      <span class="dusk-button__text">{text}</span>
    {/if}
    <Icon
      className="dusk-button__icon"
      path={icon.path}
      size={icon.size ?? "default"}
    />
  {:else if icon}
    <Icon
      className="dusk-button__icon"
      path={icon.path}
      size={icon.size ?? "default"}
    />
    {#if text}
      <span class="dusk-button__text">{text}</span>
    {/if}
  {:else if text}
    <span class="dusk-button__text">{text}</span>
  {/if}
</button>
