<script>
  import { createEventDispatcher } from "svelte";
  import { mdiArrowLeft } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import { addBasePath } from "$lib/navigation";
  import { randomUUID } from "$lib/dusk/string";

  /**
   * A staking flow as a page: the form, and beside it a summary with the
   * button that sends. On phones the summary is a review of its own, with
   * a Review button kept above the keyboard.
   */

  /** @type {string} */
  export let title;

  /** Whether the summary shows as the review, on phones. */
  export let isReviewing = false;

  /** Whether the form can be reviewed. */
  export let canReview = false;

  const id = randomUUID();
  const dispatch = createEventDispatcher();
</script>

<div class="stake-flow" class:stake-flow--review={isReviewing}>
  <section aria-labelledby="{id}-title" class="stake-flow__form">
    <a class="stake-flow__back" href={addBasePath("/dashboard/stake")}
      ><Icon path={mdiArrowLeft} />Staking</a
    >
    <h2 class="stake-flow__title" id="{id}-title">{title}</h2>
    <slot />
  </section>

  <aside aria-labelledby="{id}-summary" class="stake-flow__summary">
    <h2 class="stake-flow__summary-title" id="{id}-summary">Summary</h2>
    <slot name="summary" />
    {#if isReviewing}
      <Button
        className="stake-flow__back-button"
        icon={{ path: mdiArrowLeft }}
        on:click={() => dispatch("back")}
        text="Back"
        variant="secondary"
      />
    {/if}
  </aside>

  {#if !isReviewing}
    <div class="stake-flow__phone-bar">
      <Button
        className="stake-flow__review"
        disabled={!canReview}
        on:click={() => {
          dispatch("review");
          window.scrollTo(0, 0);
        }}
        text="Review"
        variant="primary"
      />
    </div>
  {/if}
</div>

<style lang="postcss">
  .stake-flow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    align-items: start;
    gap: 2.5rem;
    width: 100%;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 3rem 3rem;
  }

  .stake-flow__form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    min-width: 0;
  }

  .stake-flow__back {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 0.375rem;
    min-height: 44px;
    margin-bottom: -1rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
    text-decoration: none;

    & :global(.dusk-icon) {
      width: 1rem;
      height: 1rem;
    }

    &:hover {
      color: var(--calm-text);
    }
  }

  .stake-flow__title {
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .stake-flow__summary {
    position: sticky;
    top: calc(var(--header-height, 0px) + 1.5rem);
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1.5rem;
    border-radius: 1rem;
    background: var(--calm-s1);
  }

  .stake-flow__summary-title {
    font-size: 1.0625rem;
    font-weight: 500;
  }

  /* The summary's rows, total and buttons, whichever flow fills them. */
  .stake-flow__summary :global(.stake-flow__rows) {
    display: flex;
    flex-direction: column;
    margin: 0;
  }

  .stake-flow__summary :global(.stake-flow__rows > div) {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.625rem 0;
    border-top: 1px solid var(--calm-line);
    font-size: 0.875rem;
  }

  .stake-flow__summary :global(.stake-flow__rows dt) {
    color: var(--calm-muted);
  }

  .stake-flow__summary :global(.stake-flow__rows dd) {
    margin: 0;
    min-width: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .stake-flow__summary :global(.stake-flow__rows--total dd) {
    font-weight: 500;
  }

  /* An amount typed that can't go ahead, as the form says. */
  .stake-flow__summary :global(.stake-flow__rows dd.stake-flow__muted) {
    color: var(--calm-muted);
  }

  .stake-flow__summary :global(.stake-flow__send),
  .stake-flow__summary :global(.stake-flow__back-button) {
    width: 100%;
  }

  .stake-flow__summary :global(.stake-flow__final) {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    text-align: center;
  }

  .stake-flow__phone-bar {
    display: none;
  }

  @media (max-width: 63.99rem) {
    .stake-flow {
      padding: 1.25rem 1.5rem 2rem;
    }
  }

  /* Phones: the form, then a review of it before it is sent. */
  @media (max-width: 47.99rem) {
    .stake-flow {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
      padding: 0.75rem 1rem 0;
    }

    .stake-flow__summary {
      position: static;
      display: none;
    }

    .stake-flow--review .stake-flow__form {
      display: none;
    }

    .stake-flow--review .stake-flow__summary {
      display: flex;
    }

    .stake-flow__phone-bar {
      position: sticky;
      bottom: var(--keyboard-inset, 0px);
      z-index: 3;
      display: block;
      padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom));
      background: var(--calm-s0);
      box-shadow: 0 -1px 0 var(--calm-line);

      & :global(.stake-flow__review) {
        width: 100%;
      }
    }
  }
</style>
