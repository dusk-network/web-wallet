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
        {#if state === "current" && currentMessage}
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
      grid-template-columns: 1.5rem minmax(0, 1fr);
      min-height: 2.75rem;
      position: relative;
      font-size: 0.875rem;

      &:not(:last-child)::before {
        background: var(--calm-line2);
        content: "";
        height: calc(100% - 1.5rem);
        left: 0.71875rem;
        position: absolute;
        top: 1.5rem;
        width: 1px;
      }

      &--complete:not(:last-child)::before {
        background: var(--calm-muted);
      }

      & > span:last-child {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding-top: 0.125rem;
      }

      & strong {
        font-weight: 500;
      }

      & small {
        color: var(--calm-muted);
        font-size: 0.8125rem;
        line-height: 1.45;
      }
    }

    &__marker {
      align-items: center;
      background: var(--calm-s2);
      border: 1px solid var(--calm-line2);
      border-radius: 50%;
      display: flex;
      font-variant-numeric: tabular-nums;
      font-size: 0.6875rem;
      height: 1.5rem;
      justify-content: center;
      width: 1.5rem;
      z-index: 1;
    }

    &__step--complete &__marker {
      background: var(--calm-text);
      border-color: var(--calm-text);
      color: var(--calm-s0);
    }

    &__step--current &__marker {
      border-color: var(--calm-text);
      color: var(--calm-text);
    }

    &__step--pending {
      color: var(--calm-muted);
    }
  }
</style>
