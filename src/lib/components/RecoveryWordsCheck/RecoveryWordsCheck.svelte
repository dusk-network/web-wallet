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
   * under it, apart and small, Show my recovery words (`show`), which the
   * page shows them for as it shows them. `checked` says once they match.
   *
   * Each box suggests recovery words as Import's do, from the wallet's own
   * list and from what's typed alone, never from the phrase, and marks a word
   * that isn't one: "Not a recovery word". Enter, or a phone keyboard's Next,
   * goes on to the next box, whether or not suggestions show, and never
   * checks: Check, and Enter in the last box, check only once every box
   * holds a recovery word, and a check half filled in says nothing.
   *
   * What's typed is hidden the moment the page is (onPageHidden), where
   * anything is, each box's as a password is, with no suggestions, until
   * Show words.
   */
  import { createEventDispatcher, onMount, tick } from "svelte";
  import {
    RECOVERY_WORDS_MISMATCH,
    RECOVERY_WORDS_SHOW,
    recoveryWordsMatch,
  } from "@dusk-network/app-core/recovery-words";

  import { Button, Textbox } from "$lib/dusk/components";
  import { randomUUID } from "$lib/dusk/string";
  import onPageHidden from "$lib/security/onPageHidden";

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

  /** Whether a box holds a recovery word, as typed. */
  const holdsWord = (/** @type {string} */ word) => isWord(word.trim());

  /** The first box that holds no recovery word, to type in next. */
  const focusFirstEmpty = () =>
    boxes[typed.findIndex((word) => !holdsWord(word))]?.focus();

  function check() {
    // Half filled in, it's no answer: nothing is said, and the box to fill
    // in next is the one typed in.
    if (!typed.every(holdsWord)) {
      focusFirstEmpty();

      return;
    }

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
    } else if (event.key === "Enter" && !event.isComposing) {
      // On to the next box, never the check; in the last, the check once
      // every box holds a recovery word, else the first that doesn't.
      event.preventDefault();

      if (i < asked.length - 1) {
        suggesting = -1;
        boxes[i + 1]?.focus();
      } else {
        check();
      }
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

  /** Whether what's typed is hidden, as the page was: until Show words. */
  let isHidden = false;

  onMount(() =>
    onPageHidden(() => {
      if (typed.some(Boolean)) {
        isHidden = true;
        suggesting = -1;
      }
    })
  );

  // None while what's typed is hidden: they'd say what it is.
  $: suggestions =
    !isHidden && suggesting >= 0 ? suggestionsFor(typed[suggesting]) : [];

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
    </div>
    <!-- Apart, and small: Try again is the one button here. -->
    <button
      class="recovery-check__show tap-link"
      on:click={(event) => dispatch("show", event)}
      type="button">{RECOVERY_WORDS_SHOW}</button
    >
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
    {#if isHidden}
      <Button
        className="recovery-check__show-typed"
        on:click={() => {
          isHidden = false;
        }}
        text="Show words"
        variant="secondary"
      />
    {/if}
    <div
      class="recovery-check__words"
      class:recovery-check__words--hidden={isHidden}
    >
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
              enterkeyhint={i < asked.length - 1 ? "next" : "done"}
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
    <!-- The check's own button leads: Skip for now, where a flow has it,
      is quieter. -->
    <Button
      disabled={!typed.every(holdsWord)}
      text="Check"
      type="submit"
      variant="primary"
    />
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

  /* Hidden, what's typed shows as a password does. */
  .recovery-check__words--hidden :global(input) {
    -webkit-text-security: disc;
  }

  :global(.recovery-check__show-typed) {
    align-self: flex-start;
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

  /* A text link, under Try again and set apart from it. */
  .recovery-check__show {
    align-self: flex-start;
    margin-top: 1rem;
    padding: 0;
    border: 0;
    background: none;
    color: var(--calm-muted);
    font: inherit;
    font-size: 0.875rem;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }
  }
</style>
