<svelte:options immutable={true} />

<script>
  import { mdiAlertOutline, mdiCheck, mdiContentCopy } from "@mdi/js";
  import { onDestroy } from "svelte";

  import { announce } from "$lib/dusk/announce";
  import { COPIED_FOR } from "$lib/dusk/motion";

  import Button from "../Button/Button.svelte";
  import Icon from "../Icon/Icon.svelte";
  import { toast } from "../Toast/store";

  /**
   * What it copies.
   *
   * @type {string}
   */
  export let value;

  /**
   * What that is, as in "Copy address": the button's name, and the error
   * if it can't copy ("Couldn't copy the address").
   *
   * @type {string}
   */
  export let name;

  /**
   * The word it shows, as "Copy". Without one it's the icon alone.
   *
   * @type {string | undefined}
   */
  export let text = undefined;

  /** Whether it shows the copy icon. */
  export let icon = true;

  /**
   * Drawn as Duskit's buttons are, in this variant; without one, by its
   * `className` only.
   *
   * @type {ButtonVariant | undefined}
   */
  export let variant = undefined;

  /** @type {ButtonSize} */
  export let size = "default";

  /** @type {string | undefined} */
  export let className = undefined;

  /** Whether it says Copied, for a moment after it copied. */
  let copied = false;

  let timer = 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      toast(
        "error",
        error instanceof Error && error.name === "NotAllowedError"
          ? "Clipboard access denied"
          : `Couldn't copy the ${name}`,
        mdiAlertOutline
      );

      return;
    }

    copied = true;
    announce("Copied", COPIED_FOR);
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      copied = false;
    }, COPIED_FOR);
  }

  onDestroy(() => clearTimeout(timer));

  // Copied where it was pressed: the icon a check, the word Copied.
  $: label = copied ? "Copied" : `Copy ${name}`;
  $: path = copied ? mdiCheck : mdiContentCopy;
  $: word = text && copied ? "Copied" : text;
</script>

{#if variant}
  <Button
    {...$$restProps}
    aria-label={label}
    {className}
    icon={icon ? { path } : undefined}
    on:click={copy}
    {size}
    text={word}
    {variant}
  />
{:else}
  <button
    {...$$restProps}
    aria-label={label}
    class={className}
    on:click={copy}
    type="button"
  >
    {#if icon}
      <Icon {path} />
    {/if}
    {#if word}
      <span>{word}</span>
    {/if}
  </button>
{/if}
