<svelte:options immutable={true} />

<script>
  import { mdiCheckDecagramOutline } from "@mdi/js";

  import { makeClassName } from "$lib/dusk/string";
  import { Icon, Suspense } from "$lib/dusk/components";

  import { AppAnchorButton } from "..";

  /** @type {string|undefined} */
  export let className = undefined;

  /** @type {Promise<any>} */
  export let operation;

  /** @type {string} */
  export let errorMessage = "Operation failed";

  /**
   * What an error means, in a sentence that says what to do, and the
   * heading over it where it isn't `errorMessage`: none by default.
   *
   * @type {((error: Error) => { heading?: string, sentence: string }) | undefined}
   */
  export let describeError = undefined;

  /** @type {Function|undefined} */
  export let onBeforeLeave = undefined;

  /** What it waits for, in words shown with the throbber. */
  export let pendingMessage = "Loading…";

  /** @type {string} */
  export let successMessage = "Operation completed";

  function handleGoHomeClick() {
    onBeforeLeave && onBeforeLeave();
  }

  $: classes = makeClassName(["operation-result", className]);
</script>

<Suspense
  className={classes}
  {describeError}
  {errorMessage}
  gap="large"
  {pendingMessage}
  waitFor={operation}
>
  <svelte:fragment slot="success-content" let:result>
    <!-- Without a message, what's shown says it all. -->
    {#if successMessage}
      <Icon path={mdiCheckDecagramOutline} size="large" />
      <b>{successMessage}</b>
    {/if}
    <slot name="success-content" {result} />
    <AppAnchorButton
      href="/dashboard"
      on:click={handleGoHomeClick}
      variant="tertiary"
      text="Home"
    />
  </svelte:fragment>
  <svelte:fragment slot="error-extra-content" let:error>
    <slot name="error-actions" {error} />
    <AppAnchorButton
      href="/dashboard"
      on:click={handleGoHomeClick}
      text="Home"
      variant="tertiary"
    />
  </svelte:fragment>
</Suspense>

<style lang="postcss">
  :global {
    .operation-result {
      padding: 1.5em 0;

      .dusk-anchor-button,
      .dusk-button {
        width: 100%;
      }
    }
  }
</style>
