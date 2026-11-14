<svelte:options immutable={true} />

<script>
  /**
   * Checks the recovery words as they were written down: three of them,
   * chosen at random as it opens, each typed in its own box, as Import's
   * boxes take words, with nothing a password manager or a keyboard keeps.
   * They're compared here alone, and kept nowhere. A mismatch shows the
   * words again, to put the paper right. `checked` says once they match.
   */
  import { createEventDispatcher } from "svelte";

  import { Button, Textbox, Words } from "$lib/dusk/components";
  import { randomUUID } from "$lib/dusk/string";

  /**
   * The recovery words, in order.
   *
   * @type {string[]}
   */
  export let words;

  const dispatch = createEventDispatcher();
  const id = randomUUID();

  /**
   * `count` places of the words, at random, in order.
   *
   * @param {number} length
   * @param {number} count
   */
  function placesOf(length, count) {
    /** @type {number[]} */
    const places = [];

    while (places.length < Math.min(count, length)) {
      const place = crypto.getRandomValues(new Uint32Array(1))[0] % length;

      if (!places.includes(place)) {
        places.push(place);
      }
    }

    return places.sort((a, b) => a - b);
  }

  /** The words asked for, by their place. */
  const asked = placesOf(words.length, 3);

  /** What's typed in each box. */
  let typed = asked.map(() => "");

  /**
   * The places typed wrong at the last Check: none before one, or once they
   * match.
   *
   * @type {number[] | null}
   */
  let wrong = null;

  /** @param {number[]} places */
  const numbersOf = (places) =>
    places.length === 1
      ? `${places[0] + 1}`
      : `${places
          .slice(0, -1)
          .map((place) => place + 1)
          .join(", ")} and ${places[places.length - 1] + 1}`;

  function check() {
    wrong = asked.filter(
      (place, i) => typed[i].trim().toLowerCase() !== words[place]
    );

    if (!wrong.length) {
      dispatch("checked");
    }
  }
</script>

<form
  autocomplete="off"
  class="recovery-check"
  novalidate
  on:submit|preventDefault={check}
>
  <p class="recovery-check__lead">
    Type words {numbersOf(asked)} as you wrote them down.
  </p>
  <div class="recovery-check__words">
    {#each asked as place, i (place)}
      <label class="recovery-check__word" for="{id}-{place}">
        <span>Word {place + 1}</span>
        <Textbox
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          bind:value={typed[i]}
          id="{id}-{place}"
          inputmode="text"
          on:input={() => {
            wrong = null;
          }}
          spellcheck="false"
          type="text"
        />
      </label>
    {/each}
  </div>
  <Button text="Check" type="submit" variant="secondary" />
  {#if wrong && !wrong.length}
    <p class="recovery-check__match" role="status">They match.</p>
  {:else if wrong}
    <div class="recovery-check__mismatch" role="alert">
      <p>
        {wrong.length === 1
          ? `Word ${numbersOf(wrong)} doesn't match.`
          : `Words ${numbersOf(wrong)} don't match.`} Your words:
      </p>
      <Words {words} />
    </div>
  {/if}
</form>

<style lang="postcss">
  .recovery-check {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .recovery-check__lead {
    margin: 0;
  }

  .recovery-check__words {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .recovery-check__word {
    display: flex;
    flex: 1 1 8rem;
    flex-direction: column;
    gap: 0.375rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .recovery-check__match {
    margin: 0;
    color: var(--calm-text);
  }

  .recovery-check__mismatch {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    color: var(--calm-danger);

    & p {
      margin: 0;
    }
  }
</style>
