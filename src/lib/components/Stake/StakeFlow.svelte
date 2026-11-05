<script>
  import { createEventDispatcher, tick } from "svelte";
  import { mdiArrowLeft } from "@mdi/js";
  import { Button, Icon } from "$lib/dusk/components";
  import ReviewWallet from "../ReviewWallet/ReviewWallet.svelte";
  import SectionHead from "../SectionHead/SectionHead.svelte";
  import { addBasePath } from "$lib/navigation";
  import { randomUUID } from "$lib/dusk/string";

  /**
   * A staking flow as a page: the form, and beside it a summary with Review
   * (on phones, only the button shows, kept above the keyboard). The review
   * is a step of its own, where the summary takes the page, with the button
   * that sends.
   */

  /** @type {string} */
  export let title;

  /** Whether the summary shows as the review. */
  export let isReviewing = false;

  /** Whether the form can be reviewed. */
  export let canReview = false;

  /**
   * Whether the public balance is short of the network fee: on a phone, where
   * the summary waits for the review, its Edit is the way on, with the form.
   */
  export let isFeeShort = false;

  const id = randomUUID();
  const dispatch = createEventDispatcher();

  async function review() {
    if (!canReview) {
      return;
    }

    dispatch("review");
    window.scrollTo(0, 0);
    await tick();
    document.getElementById(`${id}-summary`)?.focus();
  }
</script>

<div
  class="stake-flow"
  class:stake-flow--fee-short={isFeeShort}
  class:stake-flow--review={isReviewing}
>
  <section aria-labelledby="{id}-title" class="stake-flow__form">
    <a class="stake-flow__back" href={addBasePath("/dashboard/stake")}
      ><Icon path={mdiArrowLeft} />Staking</a
    >
    <h2 class="stake-flow__title" id="{id}-title">{title}</h2>
    <slot />
  </section>

  <aside aria-labelledby="{id}-summary" class="stake-flow__summary">
    <SectionHead id="{id}-summary" tabindex="-1"
      >{isReviewing ? "Review" : "Summary"}</SectionHead
    >
    <ReviewWallet />
    <slot name="summary" />
    {#if isReviewing}
      <Button
        className="stake-flow__back-button"
        icon={{ path: mdiArrowLeft }}
        on:click={() => dispatch("back")}
        text="Back"
        variant="secondary"
      />
    {:else}
      <!-- On a phone, the one thing of the summary that shows with the form. -->
      <div class="stake-flow__review-bar">
        <Button
          className="stake-flow__review"
          disabled={!canReview}
          on:click={review}
          text="Review"
          variant="primary"
        />
      </div>
    {/if}
  </aside>
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

  /* A row's label stays on one line; its value wraps. */
  .stake-flow__summary :global(.stake-flow__rows dt) {
    flex-shrink: 0;
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

  .stake-flow__summary :global(.section-head:focus) {
    outline: none;
  }

  .stake-flow__summary :global(.stake-flow__send),
  .stake-flow__summary :global(.stake-flow__review),
  .stake-flow__summary :global(.stake-flow__back-button) {
    width: 100%;
  }

  .stake-flow__summary :global(.stake-flow__final) {
    color: var(--calm-muted);
    font-size: 0.8125rem;
    text-align: center;
  }

  /* The review: the summary takes the page, in a column of its own. */
  .stake-flow--review {
    grid-template-columns: minmax(0, 30rem);
    justify-content: center;
  }

  .stake-flow--review .stake-flow__form {
    display: none;
  }

  .stake-flow--review .stake-flow__summary {
    position: static;
  }

  @media (max-width: 63.99rem) {
    .stake-flow {
      padding: 1.25rem 1.5rem 2rem;
    }
  }

  @media (max-width: 47.99rem) {
    .stake-flow {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
      padding: 0.75rem 1rem 0;
    }

    /* The form first: of the summary, only Review, kept above the keyboard. */
    .stake-flow:not(.stake-flow--review) .stake-flow__summary {
      display: contents;
    }

    .stake-flow:not(.stake-flow--review)
      .stake-flow__summary
      > :global(:not(.stake-flow__review-bar)) {
      display: none;
    }

    .stake-flow--fee-short:not(.stake-flow--review)
      .stake-flow__summary
      > :global(.gas-settings) {
      display: block;
    }

    .stake-flow__review-bar {
      position: sticky;
      bottom: var(--keyboard-inset, 0px);
      z-index: 3;
      padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom));
      background: var(--calm-s0);
      box-shadow: 0 -1px 0 var(--calm-line);
    }
  }
</style>
