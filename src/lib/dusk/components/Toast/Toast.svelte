<script>
  import { flip } from "svelte/animate";
  import Icon from "../Icon/Icon.svelte";
  import { closeUp, messageIn, messageOut } from "$lib/dusk/motion";
  import { makeClassName } from "$lib/dusk/string";
  import { toastList, toastTimer } from "./store";
  import { onMount } from "svelte";

  /** @type {String | Undefined} */
  export let className = undefined;

  /** @type {Number} */
  export let timer = 2000;

  const classes = makeClassName(["dusk-toast", className]);

  onMount(() => {
    $toastTimer = timer;
  });
</script>

<!-- A message fades in where it stays and fades out in place; the others
  close up. -->
<ul {...$$restProps} class={classes}>
  {#each $toastList as { id, icon, message, type } (id)}
    <li
      in:messageIn|global
      out:messageOut|global
      animate:flip={closeUp()}
      class="dusk-toast__item"
    >
      {#if icon}
        <span
          class={`dusk-toast__item-icon-wrapper dusk-toast__item-icon-wrapper--${type}`}
        >
          <Icon className="dusk-toast__item-icon" path={icon} size="default" />
        </span>
      {/if}
      <span class="dusk-toast__item-message">
        {message}
      </span>
    </li>
  {/each}
</ul>
