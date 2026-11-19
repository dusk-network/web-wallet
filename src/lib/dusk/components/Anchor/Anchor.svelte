<svelte:options immutable={true} />

<script>
  import { makeClassName } from "$lib/dusk/string";
  import "./Anchor.css";

  /** @type {String | Undefined} */
  export let className = undefined;

  /** @type {String} */
  export let href;

  /** @type {boolean} */
  export let onSurface = true;

  $: classes = makeClassName([
    "dusk-anchor",
    `dusk-anchor--${onSurface ? "on-surface" : "off-surface"}`,
    className,
  ]);
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- renders the href it is given; internal callers add the base path -->
<a {...$$restProps} class={classes} {href} on:click>
  <slot />
</a>
