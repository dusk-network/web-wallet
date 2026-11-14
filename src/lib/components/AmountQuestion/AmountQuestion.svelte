<svelte:options immutable={true} />

<script>
  /**
   * What an amount that could be either of two asks, as both wallets ask it
   * (`@dusk-network/app-core/amounts`' readAmount): the question, and a
   * button for each, the decimal one first, which puts that one in the field
   * (`choose`). Nothing for an amount that reads as one, or as none.
   */
  import { readAmount } from "@dusk-network/app-core/amounts";
  import { createEventDispatcher } from "svelte";

  import { Button } from "$lib/dusk/components";
  import { makeClassName } from "$lib/dusk/string";

  /** The amount as the field holds it. */
  /** @type {string} */
  export let text;

  /** @type {string} */
  export let language;

  /** @type {string | undefined} */
  export let className = undefined;

  /** @type {string | undefined} */
  export let id = undefined;

  const dispatch = createEventDispatcher();

  $: ({ choices, question } = readAmount(text, language));
</script>

{#if question && choices}
  <div class={makeClassName(["amount-question", className])} {id} role="alert">
    <p class="amount-question__question">{question}</p>
    <div class="amount-question__choices">
      {#each choices as choice (choice.field)}
        <Button
          on:click={() => dispatch("choose", choice.field)}
          size="small"
          text={`${choice.field} DUSK`}
          variant="secondary"
        />
      {/each}
    </div>
  </div>
{/if}

<style lang="postcss">
  .amount-question {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .amount-question__question {
    margin: 0;
    color: var(--calm-danger);
  }

  .amount-question__choices {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
