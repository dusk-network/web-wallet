<svelte:options immutable={true} />

<script>
  import { Icon } from "$lib/dusk/components";
  import { logo } from "$lib/dusk/icons";

  /** @type {string | undefined} */
  export let className = undefined;
</script>

<!-- The DUSK unit after an amount, named for screen readers. -->
<Icon
  {...$$restProps}
  aria-label="DUSK"
  {className}
  data-tooltip-id="main-tooltip"
  data-tooltip-text="DUSK"
  path={logo}
  role="img"
/>
