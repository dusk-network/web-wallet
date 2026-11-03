<svelte:options immutable={true} />

<script>
  import "./CopyField.css";

  import { CopyButton, Textbox } from "$lib/dusk/components";
  import { makeClassName } from "$lib/dusk/string";

  /** @type {string | undefined} */
  export let className = undefined;

  /** @type {string} */
  export let name;

  /** @type {string} */
  export let displayValue;

  /** @type {string} */
  export let rawValue;

  /** @type {boolean} */
  export let disabled = false;

  $: classes = makeClassName(["copy-field", className]);
</script>

<div class={classes} {...$$restProps}>
  <Textbox
    aria-label={name}
    className="copy-field__content"
    value={displayValue}
    type="text"
    readOnly
  />
  <CopyButton
    className="copy-field__button"
    data-tooltip-id="main-tooltip"
    data-tooltip-text="Copy to clipboard"
    {disabled}
    {name}
    value={rawValue}
    variant="primary"
  />
</div>
