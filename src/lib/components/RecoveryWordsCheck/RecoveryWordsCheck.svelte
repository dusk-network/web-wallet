<svelte:options immutable={true} />

<script>
  /**
   * Checks the recovery words as they were written down: three of them,
   * chosen at random as it opens, each typed in its own box, as Import's
   * boxes take words, with nothing a password manager or a keyboard keeps.
   * They're compared here alone, and kept nowhere. A check says whether they
   * match and nothing more: a mismatch shows no word, nor which one is wrong,
   * with Try again, which asks the same three again, and apart from it Show
   * my recovery words (`show`), which the page shows them for as it shows
   * them. `checked` says once they match.
   */
  import { createEventDispatcher, tick } from "svelte";

  import { Button, Textbox } from "$lib/dusk/components";
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
   * What the last Check said: null before one, and once what's typed
   * changes.
   *
   * @type {"match" | "mismatch" | null}
   */
  let result = null;

  /** @type {Textbox[]} */
  const boxes = [];

  /** @param {number[]} places */
  const numbersOf = (places) =>
    places.length === 1
      ? `${places[0] + 1}`
      : `${places
          .slice(0, -1)
          .map((place) => place + 1)
          .join(", ")} and ${places[places.length - 1] + 1}`;

  function check() {
    const isMatch = asked.every(
      (place, i) => typed[i].trim().toLowerCase() === words[place]
    );

    result = isMatch ? "match" : "mismatch";

    if (isMatch) {
      dispatch("checked");
    } else {
      // Gone with the boxes: Try again asks for all three again.
      typed = asked.map(() => "");
    }
  }

  /** The same three again, empty, the first to type in. */
  async function tryAgain() {
    result = null;
    await tick();
    boxes[0]?.focus();
  }
</script>

{#if result === "mismatch"}
  <div class="recovery-check">
    <p class="recovery-check__mismatch" role="alert">
      That doesn't match your recovery words. Check the words you wrote down.
    </p>
    <div class="recovery-check__actions">
      <Button on:click={tryAgain} text="Try again" variant="primary" />
      <Button
        on:click={(event) => dispatch("show", event)}
        text="Show my recovery words"
        variant="secondary"
      />
    </div>
  </div>
{:else}
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
            bind:this={boxes[i]}
            bind:value={typed[i]}
            id="{id}-{place}"
            inputmode="text"
            on:input={() => {
              result = null;
            }}
            spellcheck="false"
            type="text"
          />
        </label>
      {/each}
    </div>
    <Button text="Check" type="submit" variant="secondary" />
    {#if result === "match"}
      <p class="recovery-check__match" role="status">They match.</p>
    {/if}
  </form>
{/if}

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
    margin: 0;
    color: var(--calm-danger);
  }

  .recovery-check__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
