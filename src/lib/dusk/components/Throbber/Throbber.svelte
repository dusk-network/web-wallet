<svelte:options immutable={true} />

<script>
  import { makeClassName } from "$lib/dusk/string";

  /** @type {String | Undefined} */
  export let className = undefined;

  /**
   * How long a turn takes, in milliseconds.
   * @type {Number}
   */
  export let duration = 1800;

  /**
   * The throbber's size in pixels.
   * @type {Number}
   */
  export let size = 64;

  const path = [
    "M75.4 126.63",
    "a11.43 11.43 0 0 1-2.1-22.65 ",
    "40.9 40.9 0 0 0 30.5-30.6 ",
    "11.4 11.4 0 1 1 22.27 4.87",
    "h.02",
    "a63.77 63.77 0 0 1-47.8 48.05",
    "v-.02",
    "a11.38 11.38 0 0 1-2.93.37",
    "z",
  ].join("");
</script>

<!-- It turns in CSS, which stops it where less motion is asked for. -->
<svg
  class={makeClassName(["dusk-throbber", className])}
  height={`${size}px`}
  role="progressbar"
  style:--dusk-throbber-duration={`${duration}ms`}
  viewBox="0 0 128 128"
  width={`${size}px`}
>
  <path d={path} />
</svg>
