<svelte:options immutable={true} />

<script>
  import { mdiCloseThick } from "@mdi/js";

  import { makeClassName } from "$lib/dusk/string";

  import { ErrorDetails, Icon } from "..";

  /** @type {string | undefined} */
  export let className = undefined;

  /** @type {Error} */
  export let error;

  /** @type {GapSize} */
  export let gap = "default";

  /** @type {string} */
  export let summary;

  /**
   * What the error means, in a sentence that says what to do: with one,
   * the summary is a heading over it, and the error's own message is under
   * Details.
   *
   * @type {string}
   */
  export let description = "";

  $: classes = makeClassName([
    "dusk-error-alert",
    gap !== "default" ? `dusk-error-alert--${gap}-gap` : "",
    className,
  ]);
</script>

<div {...$$restProps} class={classes}>
  <Icon className="dusk-error-alert__icon" path={mdiCloseThick} size="large" />
  {#if description}
    <div class="dusk-error-alert__text">
      <b class="dusk-error-alert__summary">{summary}</b>
      <p class="dusk-error-alert__description">{description}</p>
    </div>
    <ErrorDetails
      className="dusk-error-alert__error-details"
      {error}
      summary="Details"
    />
  {:else}
    <ErrorDetails
      className="dusk-error-alert__error-details"
      {error}
      {summary}
    />
  {/if}
</div>
