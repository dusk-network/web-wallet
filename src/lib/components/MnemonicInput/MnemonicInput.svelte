<script>
  /**
   * A recovery phrase's words, each in its own numbered box (12 or 24), as
   * people copy them from paper.
   *
   * - A whole phrase (12 words or more) pasted or typed into any box fills
   *   the boxes from the first, in order, and sets 12 or 24 by its length;
   *   a few words go where they're put.
   * - A word that isn't a recovery word is marked once a paste puts it in
   *   or its box is left, never while it's typed; it clears once it's one.
   * - What's wrong with the words is said in one plain sentence after a
   *   paste and when the focus leaves the boxes, and goes as soon as
   *   something's typed. `error`, from outside, shows there too.
   */
  import { createEventDispatcher, tick } from "svelte";

  import { randomUUID } from "$lib/dusk/string";

  import { RECOVERY_WORDS, phraseProblem, wordsOf } from "./phraseProblem";

  /** The words of the boxes shown, one space between: "" for none. */
  export let mnemonic = "";

  /** Whether the boxes hold a recovery phrase. */
  export let isValid = false;

  /** What's wrong with the phrase, said from outside: "" for nothing. */
  export let error = "";

  /** @type {boolean} */
  export let disabled = false;

  /**
   * The words the boxes start with.
   *
   * @type {string[]}
   */
  export let initialWords = [];

  /** What the boxes are called. */
  export let label = "Recovery phrase";

  const MAX = 24;
  const id = randomUUID();
  const dispatch = createEventDispatcher();

  let count = initialWords.filter(Boolean).length > 12 ? 24 : 12;

  /** The boxes' words: all 24, the hidden ones kept empty. */
  let values = Array.from({ length: MAX }, (_, i) =>
    String(initialWords[i] ?? "")
      .trim()
      .toLowerCase()
  );

  /** The boxes marked: their word isn't a recovery word. */
  let marked = Array.from({ length: MAX }, () => false);

  /** A paste with more words than there are boxes: its count, until the next edit. */
  let overflow = 0;

  /** What's wrong, as said after a paste or as the focus left the boxes. */
  let problem = "";

  /** @type {HTMLInputElement[]} */
  const inputs = [];

  /** @type {HTMLDivElement} */
  let grid;

  /** @param {number} i */
  function mark(i) {
    marked[i] = Boolean(values[i]) && !RECOVERY_WORDS.has(values[i]);
  }

  function markAll() {
    marked = values.map((word) => Boolean(word) && !RECOVERY_WORDS.has(word));
  }

  /** @param {number} i */
  async function focusBox(i) {
    await tick();
    inputs[Math.max(0, Math.min(i, count - 1))]?.focus();
  }

  const shownWords = () => values.slice(0, count);
  const problemNow = () => phraseProblem(shownWords(), { pasted: overflow });

  /**
   * A whole phrase: every box from the first, 12 or 24 by its length (24
   * for any other count over 12, so every word shows), then the last
   * word's box, from which Tab leaves the words.
   *
   * @param {string[]} words
   */
  function placePhrase(words) {
    count = words.length > 12 ? 24 : 12;
    values = Array.from({ length: MAX }, (_, i) => words[i] ?? "");
    overflow = words.length > MAX ? words.length : 0;
    markAll();
    focusBox(Math.min(words.length, count) - 1);
  }

  /**
   * A few words, from box `start` on; then the next empty box.
   *
   * @param {number} start
   * @param {string[]} words
   */
  function placeWords(start, words) {
    if (count === 12 && start + words.length > 12) {
      count = 24;
    }

    for (let j = 0; j < words.length && start + j < MAX; j++) {
      values[start + j] = words[j];
      mark(start + j);
    }

    const empty = shownWords().indexOf("");

    focusBox(empty === -1 ? start + words.length - 1 : empty);
  }

  /**
   * Words that came at once, by a paste or typed with spaces, into box `i`.
   *
   * @param {number} i
   * @param {string[]} words
   */
  function takeWords(i, words) {
    if (words.length >= 12) {
      placePhrase(words);
      problem = problemNow();
    } else {
      overflow = 0;
      placeWords(i, words);

      // A few words: only those that aren't recovery words, said now.
      problem = shownWords().some((w) => w && !RECOVERY_WORDS.has(w))
        ? problemNow()
        : "";
    }

    dispatch("change");
  }

  /**
   * @param {number} i
   * @param {ClipboardEvent} event
   */
  function handlePaste(i, event) {
    const words = wordsOf(event.clipboardData?.getData("text") ?? "");

    event.preventDefault();

    if (words.length) {
      takeWords(i, words);
    }
  }

  /** @param {number} i */
  function handleInput(i) {
    const raw = inputs[i].value;

    if (/\s/.test(raw)) {
      const words = wordsOf(raw);

      if (words.length >= 12 || words.length > 1) {
        values[i] = "";
        takeWords(i, words);

        return;
      }

      values[i] = words[0] ?? "";
      inputs[i].value = values[i];
    } else {
      values[i] = raw.toLowerCase();
    }

    overflow = 0;

    // A word typed: its mark goes once it's a word; a new one waits for the
    // box to be left.
    if (marked[i]) {
      mark(i);
    }

    problem = "";
    dispatch("change");
  }

  /**
   * @param {number} i
   * @param {KeyboardEvent} event
   */
  function handleKeyDown(i, event) {
    if ((event.key === "Enter" || event.key === " ") && values[i]) {
      event.preventDefault();

      if (i >= count - 1) {
        dispatch("complete");
      } else {
        focusBox(i + 1);
      }
    } else if (event.key === "Backspace" && !values[i] && i > 0) {
      event.preventDefault();
      focusBox(i - 1);
    }
  }

  /**
   * A box left: its word marked if it isn't one. The words left for
   * something else: what's wrong with them, once there are any.
   *
   * @param {FocusEvent} event
   */
  function handleFocusOut(event) {
    const i = inputs.indexOf(/** @type {HTMLInputElement} */ (event.target));

    if (i >= 0) {
      mark(i);
    }

    if (!grid.contains(/** @type {Node | null} */ (event.relatedTarget))) {
      problem = problemNow();
    }
  }

  /** @param {number} next 12 or 24 */
  function setCount(next) {
    count = next;

    for (let i = count; i < MAX; i++) {
      values[i] = "";
      marked[i] = false;
    }

    problem = "";
    dispatch("change");
  }

  $: shown = values.slice(0, count);
  $: mnemonic = shown.filter(Boolean).join(" ");
  $: isValid = shown.every(Boolean) && !phraseProblem(shown);
  $: said = problem || error;
</script>

<div class="mnemonic-input">
  <div aria-label="How many words" class="mnemonic-input__count" role="group">
    {#each [12, 24] as n (n)}
      <button
        aria-pressed={count === n}
        class="mnemonic-input__count-button"
        class:mnemonic-input__count-button--on={count === n}
        {disabled}
        on:click={() => setCount(n)}
        type="button">{n} words</button
      >
    {/each}
  </div>
  <p class="mnemonic-input__hint" id="{id}-hint">
    Paste the whole phrase into any box.
  </p>
  <div
    aria-describedby={said ? `${id}-hint ${id}-problem` : `${id}-hint`}
    aria-label={label}
    bind:this={grid}
    class="mnemonic-input__grid"
    on:focusout={handleFocusOut}
    role="group"
  >
    {#each shown as word, i (i)}
      <label
        class="mnemonic-input__word"
        class:mnemonic-input__word--marked={marked[i]}
      >
        <span aria-hidden="true" class="mnemonic-input__index">{i + 1}</span>
        <input
          aria-invalid={marked[i] ? "true" : undefined}
          aria-label="Word {i + 1}"
          autocapitalize="none"
          autocomplete="off"
          bind:this={inputs[i]}
          {disabled}
          enterkeyhint={i === count - 1 ? "done" : "next"}
          inputmode="text"
          on:input={() => handleInput(i)}
          on:keydown={(event) => handleKeyDown(i, event)}
          on:paste={(event) => handlePaste(i, event)}
          spellcheck="false"
          type="text"
          value={word}
        />
      </label>
    {/each}
  </div>
  {#if said}
    <p class="mnemonic-input__problem" id="{id}-problem" role="alert">
      {said}
    </p>
  {/if}
</div>

<style lang="postcss">
  .mnemonic-input {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .mnemonic-input__count {
    display: inline-flex;
    align-self: flex-start;
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 999px;
    background: var(--calm-s1);
  }

  .mnemonic-input__count-button {
    min-height: 2.25rem;
    padding: 0 1rem;
    border: 0 none;
    border-radius: 999px;
    background: none;
    color: var(--calm-muted);
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;

    &--on {
      background: var(--calm-s3);
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
    }
  }

  .mnemonic-input__hint {
    color: var(--calm-muted);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .mnemonic-input__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  @media (min-width: 36rem) {
    .mnemonic-input__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  /*
   * Each box has an edge that reads as one, 3:1 or more on its surface; the
   * box typed in takes the focus ring.
   */
  .mnemonic-input__word {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0 0.75rem;
    border: 1px solid var(--calm-field-edge);
    border-radius: 0.75rem;
    background: var(--calm-field);

    &:focus-within {
      border-color: var(--calm-focus);
      box-shadow: 0 0 0 3px var(--focus-ring-color);
    }

    &--marked,
    &--marked:focus-within {
      border-color: var(--calm-danger);
    }
  }

  .mnemonic-input__index {
    min-width: 1.25rem;
    color: var(--calm-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .mnemonic-input__word input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0 none;
    outline: 0 none;
    background: none;
    color: var(--calm-text);
    font: inherit;
    font-size: 0.9375rem;
  }

  .mnemonic-input__problem {
    color: var(--calm-danger);
    font-size: 0.875rem;
    line-height: 1.4;
  }
</style>
