<script>
  import { mdiCheck } from "@mdi/js";

  import { Icon } from "$lib/dusk/components";

  /** @type {readonly string[]} */
  export let steps;

  /** @type {number} */
  export let progress;

  /** @type {string} */
  export let currentMessage;

  /**
   * @param {number} index
   * @param {number} currentProgress
   * @param {number} stepCount
   */
  function stepState(index, currentProgress, stepCount) {
    if (currentProgress === stepCount || index < currentProgress) {
      return "complete";
    }

    return index === currentProgress ? "current" : "pending";
  }

  $: states = steps.map((_, index) => stepState(index, progress, steps.length));
</script>

<ol class="bridge-timeline" aria-label="Bridge transaction progress">
  {#each steps as step, index (step)}
    {@const state = states[index]}
    <li
      class={`bridge-timeline__step bridge-timeline__step--${state}`}
      aria-current={state === "current" ? "step" : undefined}
    >
      <span class="bridge-timeline__marker">
        {#if state === "complete"}
          <Icon path={mdiCheck} size="small" />
        {:else}
          {index + 1}
        {/if}
      </span>
      <span>
        <strong>{step}</strong>
        {#if state === "current"}
          <small>{currentMessage}</small>
        {/if}
      </span>
    </li>
  {/each}
</ol>

<style lang="postcss">
  .bridge-timeline {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;

    &__step {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1.75rem minmax(0, 1fr);
      min-height: 3.5rem;
      position: relative;

      &:not(:last-child)::before {
        background: var(--surface-border-color);
        content: "";
        height: calc(100% - 1.25rem);
        left: 0.84375rem;
        position: absolute;
        top: 1.75rem;
        width: 1px;
      }

      &--complete:not(:last-child)::before {
        background: var(--success-color);
      }

      & > span:last-child {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding-top: 0.2rem;
      }

      & small {
        color: var(--secondary-text-color);
        line-height: 1.45;
      }
    }

    &__marker {
      align-items: center;
      background: var(--surface-soft-color);
      border: 1px solid var(--surface-border-color);
      border-radius: 50%;
      display: flex;
      font-family: var(--mono-font-family);
      font-size: 0.75rem;
      height: 1.75rem;
      justify-content: center;
      width: 1.75rem;
      z-index: 1;
    }

    &__step--complete &__marker {
      background: var(--status-success-bg-color);
      border-color: var(--success-color);
      color: var(--success-color);
    }

    &__step--current &__marker {
      border-color: var(--secondary-color);
      box-shadow: 0 0 0 2px var(--surface-hover-color);
      color: var(--secondary-color);
    }

    &__step--pending {
      color: var(--secondary-text-color);
    }
  }
</style>
