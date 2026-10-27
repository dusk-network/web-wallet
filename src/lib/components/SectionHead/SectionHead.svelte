<svelte:options immutable={true} />

<script>
  import { makeClassName } from "$lib/dusk/string";

  /**
   * A section's head, as `[ ACTIVITY ]`: its words in the ledger's type,
   * between brackets in the muted text colour that screen readers skip. A
   * page's own title is not one, and stays plain.
   */

  /** @type {2 | 3 | 4} */
  export let level = 2;

  /** @type {string | undefined} */
  export let className = undefined;
</script>

<svelte:element
  this={`h${level}`}
  {...$$restProps}
  class={makeClassName(["section-head", className])}
  ><span
    aria-hidden="true"
    class="section-head__bracket section-head__bracket--open">[</span
  ><slot /><span
    aria-hidden="true"
    class="section-head__bracket section-head__bracket--close">]</span
  ></svelte:element
>
