<svelte:options immutable={true} />

<script>
  import { getErrorFrom } from "$lib/dusk/error";
  import { makeClassName } from "$lib/dusk/string";

  import { ErrorAlert, ErrorDetails, Throbber } from "..";

  /** @type {string | undefined} */
  export let className = undefined;

  /** @type {string} */
  export let errorMessage = "Error";

  /**
   * What an error means, in a sentence that says what to do, shown with
   * the alert, and the heading over it, where it isn't `errorMessage`: none
   * by default.
   *
   * @type {((error: Error) => { heading?: string, sentence: string }) | undefined}
   */
  export let describeError = undefined;

  /** @type {SuspenseErrorVariant} */
  export let errorVariant = "alert";

  /** @type {GapSize} */
  export let gap = "default";

  /** @type {string} */
  export let pendingMessage = "";

  /** @type {Promise<any>} */
  export let waitFor;

  $: classes = makeClassName([
    "dusk-suspense",
    gap !== "default" ? `dusk-suspense--${gap}-gap` : "",
    className,
  ]);
</script>

<div {...$$restProps} class={classes}>
  {#await waitFor}
    <slot name="pending-content">
      <Throbber className="dusk-suspense__throbber" />
      <span class="dusk-suspense__pending-message">{pendingMessage}</span>
    </slot>
  {:then result}
    <slot name="success-content" {result} />
  {:catch thrownError}
    {@const error = getErrorFrom(thrownError)}
    {@const ErrorComponent =
      errorVariant === "alert" ? ErrorAlert : ErrorDetails}
    {@const described =
      errorVariant === "alert" ? describeError?.(error) : undefined}
    {@const extraProps =
      errorVariant === "alert"
        ? { description: described?.sentence ?? "", gap }
        : {}}
    <slot name="error-content" {error}>
      <svelte:component
        this={ErrorComponent}
        className="dusk-suspense__error"
        {error}
        summary={described?.heading ?? errorMessage}
        {...extraProps}
      />
      <slot name="error-extra-content" {error} />
    </slot>
    <slot name="error-actions" />
  {/await}
</div>
