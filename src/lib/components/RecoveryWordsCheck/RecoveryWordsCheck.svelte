<svelte:options immutable={true} />

<script>
  /**
   * Checks the recovery words as they were written down: three of them,
   * chosen at random as it opens, each typed in its own box, as Import's
   * boxes take words, with nothing a password manager or a keyboard keeps.
   * They're compared here alone, as both wallets compare them
   * (`@dusk-network/app-core/recovery-words`), and kept nowhere. A check
   * says whether they match and nothing more: a mismatch shows no word, nor
   * which one is wrong, with Try again, which asks the same three again, and
   * apart from it Show my recovery words (`show`), which the page shows them
   * for as it shows them. `checked` says once they match.
   *
   * Each box suggests recovery words as Import's do, from the wallet's own
   * list and from what's typed alone, never from the phrase, and marks a word
   * that isn't one: "Not a recovery word".
   */
  import { createEventDispatcher, tick } from "svelte";
  import {
    RECOVERY_WORDS_MISMATCH,
    RECOVERY_WORDS_SHOW,
    recoveryWordsMatch,
  } from "@dusk-network/app-core/recovery-words";

  import { Button, Textbox } from "$lib/dusk/components";
  import { randomUUID } from "$lib/dusk/string";

  import {
    NOT_A_WORD,
    isWord,
    markAsTyped,
    optionId,
    suggestionKey,
    suggestionsFor,
  } from "../MnemonicInput/suggestions";
  import WordSuggestions from "../MnemonicInput/WordSuggestions.svelte";

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

  /** The boxes marked: their word isn't a recovery word. */
  let marked = asked.map(() => false);

  /** The box typed in, whose suggestions show: -1 for none. */
  let suggesting = -1;

  /** The highlighted suggestion's place. */
  let active = 0;

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
    const isMatch = recoveryWordsMatch(
      words,
      asked.map(
        (place, i) => /** @type {[number, string]} */ ([place + 1, typed[i]])
      )
    );

    result = isMatch ? "match" : "mismatch";

    if (isMatch) {
      dispatch("checked");
    } else {
      // Gone with the boxes: Try again asks for all three again.
      typed = asked.map(() => "");
      marked = asked.map(() => false);
    }
  }

  /**
   * @param {number} i
   * @param {boolean} isMarked
   */
  const markBox = (i, isMarked) => {
    marked = marked.map((was, j) => (j === i ? isMarked : was));
  };

  /**
   * A word typed: marked at once if no recovery word starts with it, its
   * suggestions shown.
   *
   * @param {number} i
   * @param {Event} event
   */
  function handleInput(i, event) {
    const box = /** @type {HTMLInputElement} */ (event.target);

    // As a new list, which what follows from it sees (immutable).
    typed = typed.map((was, j) => (j === i ? box.value : was));
    result = null;
    markBox(i, markAsTyped(box.value, marked[i]));
    suggesting = document.activeElement === box ? i : -1;
    active = 0;
  }

  /**
   * A suggested word taken into box `i`, which goes on to the next box: the
   * focus first, so a phone's keyboard is done with the letters it had.
   *
   * @param {number} i
   * @param {string} word
   */
  function takeSuggestion(i, word) {
    suggesting = -1;

    if (i < asked.length - 1) {
      boxes[i + 1]?.focus();
    }

    typed = typed.map((was, j) => (j === i ? word : was));
    markBox(i, false);
    result = null;
  }

  /**
   * @param {number} i
   * @param {KeyboardEvent} event
   */
  function handleKeyDown(i, event) {
    const key =
      suggesting === i && suggestions.length ? suggestionKey(event) : "";

    if (key === "next" || key === "previous") {
      event.preventDefault();
      active =
        (active + (key === "next" ? 1 : suggestions.length - 1)) %
        suggestions.length;
    } else if (key === "take") {
      // Tab from the last box goes on to Check, as it would.
      if (event.key === "Enter" || i < asked.length - 1) {
        event.preventDefault();
      }

      takeSuggestion(i, suggestions[active]);
    } else if (key === "close") {
      event.preventDefault();
      suggesting = -1;
    }
  }

  /**
   * A box left: its word marked if it isn't one, its suggestions gone.
   *
   * @param {number} i
   */
  function handleBlur(i) {
    markBox(i, Boolean(typed[i]) && !isWord(typed[i]));

    if (suggesting === i) {
      suggesting = -1;
    }
  }

  $: suggestions = suggesting >= 0 ? suggestionsFor(typed[suggesting]) : [];

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
      {RECOVERY_WORDS_MISMATCH}
    </p>
    <div class="recovery-check__actions">
      <Button on:click={tryAgain} text="Try again" variant="primary" />
      <Button
        on:click={(event) => dispatch("show", event)}
        text={RECOVERY_WORDS_SHOW}
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
        {@const isSuggesting = suggesting === i && suggestions.length > 0}
        <div class="recovery-check__cell">
          <label class="recovery-check__word" for="{id}-{place}">
            <span>Word {place + 1}</span>
            <Textbox
              aria-activedescendant={isSuggesting
                ? optionId(`${id}-suggestions`, suggestions[active])
                : undefined}
              aria-autocomplete="list"
              aria-controls={isSuggesting ? `${id}-suggestions` : undefined}
              aria-describedby={marked[i] ? `${id}-not-${place}` : undefined}
              aria-expanded={isSuggesting}
              aria-invalid={marked[i] ? "true" : undefined}
              autocapitalize="none"
              autocomplete="off"
              autocorrect="off"
              bind:this={boxes[i]}
              bind:value={typed[i]}
              id="{id}-{place}"
              inputmode="text"
              on:blur={() => handleBlur(i)}
              on:input={(event) => handleInput(i, event)}
              on:keydown={(event) => handleKeyDown(i, event)}
              role="combobox"
              spellcheck="false"
              type="text"
            />
          </label>
          {#if marked[i]}
            <span class="recovery-check__not" id="{id}-not-{place}"
              >{NOT_A_WORD}</span
            >
          {/if}
          {#if isSuggesting}
            <WordSuggestions
              {active}
              id="{id}-suggestions"
              on:take={(event) => takeSuggestion(i, event.detail)}
              words={suggestions}
            />
          {/if}
        </div>
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

  /* A box, what's said of its word under it, and its suggestions over what follows. */
  .recovery-check__cell {
    position: relative;
    display: flex;
    flex: 1 1 8rem;
    flex-direction: column;
    gap: 0.25rem;
  }

  .recovery-check__word {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .recovery-check__not {
    color: var(--calm-danger);
    font-size: 0.75rem;
    line-height: 1.3;
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
