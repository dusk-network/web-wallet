<svelte:options immutable={true} />

<script>
  import { Card } from "$lib/dusk/components";
  import { pageTitle } from "$lib/navigation";
  import "./Card.css";

  /**
   * A card that is the page itself, as a one-column flow's is: its heading
   * is the page's title, the one heading with the page's name.
   */

  /** @type {string} */
  export let heading;

  /** @type {string | undefined} */
  export let className = undefined;

  /** @type {CardGap} */
  export let gap = "default";
</script>

<Card {...$$restProps} {className} {gap}>
  <header slot="header" class="dusk-card__header">
    <div class="dusk-card__heading-container">
      <h1 class="h4" use:pageTitle>{heading}</h1>
    </div>
  </header>
  <slot />
</Card>
