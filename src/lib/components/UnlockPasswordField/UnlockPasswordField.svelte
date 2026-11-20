<script>
  /**
   * The password the wallets here share, for a change to them (adding one,
   * removing one): named for what it is, with no placeholder, a line under
   * it that says one password unlocks them all, and its error under that.
   */
  import { Textbox } from "$lib/dusk/components";
  import { randomUUID } from "$lib/dusk/string";

  /** @type {string} */
  export let value = "";

  /** What's wrong with it: "" for nothing. */
  export let error = "";

  /** @type {boolean} */
  export let disabled = false;

  const id = randomUUID();

  /** @type {Textbox} */
  let field;

  export const focus = () => field?.focus();
</script>

<div class="unlock-password">
  <label class="unlock-password__label" for="{id}-password"
    >Password you unlock with</label
  >
  <Textbox
    aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
    aria-invalid={error ? "true" : undefined}
    autocomplete="current-password"
    bind:this={field}
    bind:value
    {disabled}
    id="{id}-password"
    on:input={() => {
      error = "";
    }}
    type="password"
  />
  <p class="unlock-password__hint" id="{id}-hint">
    One password unlocks every wallet in this browser.
  </p>
  {#if error}
    <p class="unlock-password__error" id="{id}-error" role="alert">
      {error}
    </p>
  {/if}
</div>

<style lang="postcss">
  .unlock-password {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .unlock-password__label {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .unlock-password__hint {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .unlock-password__error {
    color: var(--calm-danger);
    font-size: 0.875rem;
    line-height: 1.4;
  }
</style>
