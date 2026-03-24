<svelte:options immutable />

<script>
  import { createEventDispatcher, onMount, tick } from "svelte";
  import { Textbox } from "$lib/dusk/components";
  import { makeClassName } from "$lib/dusk/string";
  import "./BigIntInput.css";

  /** @type {string | undefined} */
  export let className = undefined;

  const dispatch = createEventDispatcher();

  /** @type {bigint} */
  export let minValue = 0n;

  /** @type {bigint} */
  export let maxValue = 9007199254740991n;

  /** @type {bigint} */
  export let value = 0n;

  /** @type {string} */
  let internalValue;

  /** @type {(v: bigint, min: bigint, max: bigint) => boolean} */
  const isInvalidInput = (v, min, max) => !!(min > v || v > max);

  const checkValidity = () => {
    if (isInvalidInput(value, minValue, maxValue)) {
      dispatch("error", "Value exceeds limits");
    }
  };

  /**
   * We must await Svelte's microtask queue before parsing.
   * The `bind:value` updates `internalValue` with the raw,
   * potentially invalid DOM string.
   * Awaiting a tick forces Svelte to flush this dirty state
   * to the DOM first.
   * If parsing fails, the catch block restores the previous
   * valid string, which forces Svelte to register a legitimate
   * state mutation and wipe the invalid characters from the UI.
   *
   * The situation is not ideal, but it's a quick fix that makes
   * the component work as its author intended at least.
   */
  async function validateInput() {
    try {
      await tick();
      value = BigInt(internalValue);
      checkValidity();
      dispatch("change", value);
    } catch {
      internalValue = value.toString();
    }
  }

  onMount(() => {
    checkValidity();
  });

  $: inputClass = makeClassName({
    "invalid-input": isInvalidInput(value, minValue, maxValue),
    [`${className}`]: true,
  });
  $: {
    internalValue = value.toString();
  }
</script>

<Textbox
  {...$$restProps}
  className={inputClass}
  inputmode="numeric"
  type="text"
  bind:value={internalValue}
  on:input={validateInput}
  pattern="\d+"
/>
