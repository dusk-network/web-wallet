<script>
  /**
   * A recovery phrase's words, each in its own numbered box (12 or 24), as
   * people copy them from paper.
   *
   * - A whole phrase (12 words or more) pasted or typed into any box fills
   *   the boxes from the first, in order, and sets 12 or 24 by its length;
   *   a few words go where they're put.
   * - Enter, or a space after a word, goes on to the next box: a space as a
   *   key, or as text, as a phone's keyboard sends it.
   * - As a word is typed, from two letters, the recovery words that start
   *   with them, up to four, show as chips right under its box, from the
   *   wallet's own list (WordSuggestions): a tap, Enter or Tab takes the
   *   highlighted one, the first until the arrow keys move it, and goes on
   *   to the next box; Escape closes them. A single word they spell needs
   *   none. They show for the box typed in, and go as it's left.
   * - A word that isn't a recovery word is marked in its box, "Not a
   *   recovery word": as it's typed once no recovery word starts with it,
   *   and once a paste puts it in or its box is left; it clears once it's
   *   one, or as it's typed once one starts with it.
   * - What's wrong with the words is said in one plain sentence after a
   *   paste and when the focus leaves the boxes, and goes as soon as
   *   something's typed. `error`, from outside, shows there too.
   * - Paste, where the browser lets a page read what's copied, puts it in
   *   the boxes as a paste into the first box does.
   * - What was pasted goes from the clipboard, where the browser lets a page
   *   write it, in the paste's own gesture; where it doesn't, that it's
   *   still there is said once.
   * - The words are hidden the moment the page is (onPageHidden), where
   *   any are in, each box's as a password is, with no suggestions, until
   *   Show words.
   * - On a phone (touchOnly), each box's word is typed masked, as a
   *   password is, its suggestions kept, and the words show, read only, only
   *   while Hold to show words is held, under them: a phone's app switcher
   *   can keep a picture of the page as it's left.
   */
  import { createEventDispatcher, onMount, tick } from "svelte";
  import { mdiAlertOutline, mdiContentPaste } from "@mdi/js";

  import { Button } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { randomUUID } from "$lib/dusk/string";
  import onPageHidden from "$lib/security/onPageHidden";
  import { touchOnly } from "$lib/security/touchOnly";

  import { phraseProblem, wordsOf } from "./phraseProblem";
  import {
    NOT_A_WORD,
    isWord,
    listWord,
    markAsTyped,
    optionId,
    suggestionKey,
    suggestionsFor,
  } from "./suggestions";
  import WordSuggestions from "./WordSuggestions.svelte";
  import HoldToShow from "../HoldToShow/HoldToShow.svelte";

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
      .toLowerCase(),
  );

  /** The boxes marked: their word isn't a recovery word. */
  let marked = Array.from({ length: MAX }, () => false);

  /** The box typed in, whose suggestions show: -1 for none. */
  let suggesting = -1;

  /** The highlighted suggestion's place. */
  let active = 0;

  /** A paste with more words than there are boxes: its count, until the next edit. */
  let overflow = 0;

  /** What's wrong, as said after a paste or as the focus left the boxes. */
  let problem = "";

  /** Whether what was pasted is still on the clipboard, as it couldn't go. */
  let isLeftCopied = false;

  /**
   * Clears the clipboard of words pasted from it, in the paste's own
   * gesture: where the browser won't let a page write it, it's said.
   */
  function clearCopied() {
    /** @type {Promise<void> | undefined} */
    let cleared;

    try {
      cleared = navigator.clipboard?.writeText?.("");
    } catch {
      cleared = undefined;
    }

    if (!cleared) {
      isLeftCopied = true;

      return;
    }

    cleared.then(
      () => {
        isLeftCopied = false;
      },
      () => {
        isLeftCopied = true;
      },
    );
  }

  /** @type {HTMLInputElement[]} */
  const inputs = [];

  /** @type {HTMLDivElement} */
  let grid;

  /** @param {number} i */
  function mark(i) {
    marked[i] = Boolean(values[i]) && !isWord(values[i]);
  }

  function markAll() {
    marked = values.map((word) => Boolean(word) && !isWord(word));
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
    suggesting = -1;

    if (words.length >= 12) {
      placePhrase(words);
      problem = problemNow();
    } else {
      overflow = 0;
      placeWords(i, words);

      // A few words: only those that aren't recovery words, said now.
      problem = shownWords().some((w) => w && !isWord(w)) ? problemNow() : "";
    }

    dispatch("change");
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

    if (i < count - 1) {
      inputs[i + 1]?.focus();
    }

    values[i] = word;
    inputs[i].value = word;
    marked[i] = false;
    overflow = 0;
    problem = "";
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
      clearCopied();
      takeWords(i, words);
    }
  }

  /**
   * On from box `i`, as Enter and a space go: to the next box, or from the
   * last one to what comes after the words.
   *
   * @param {number} i
   */
  function moveOn(i) {
    if (i >= count - 1) {
      dispatch("complete");
    } else {
      focusBox(i + 1);
    }
  }

  /** @param {number} i */
  function handleInput(i) {
    const raw = inputs[i].value;
    let isSpaced = false;

    if (/\s/.test(raw)) {
      const words = wordsOf(raw);

      if (words.length >= 12 || words.length > 1) {
        values[i] = "";
        takeWords(i, words);

        return;
      }

      values[i] = words[0] ?? "";
      inputs[i].value = values[i];
      // A space after the word, as a phone's keyboard sends it, as text.
      isSpaced = Boolean(values[i]) && /\s$/.test(raw);
    } else {
      values[i] = raw.toLowerCase();
    }

    overflow = 0;
    problem = "";

    if (isSpaced) {
      // On, as the space key goes: the word as typed, marked as it's left.
      mark(i);
      suggesting = -1;
      dispatch("change");
      moveOn(i);

      return;
    }

    // A word typed: marked at once if no recovery word starts with it, and
    // its mark gone once one does; whether it's one is for when it's left.
    marked[i] = markAsTyped(values[i], marked[i]);
    suggesting = document.activeElement === inputs[i] ? i : -1;
    active = 0;
    dispatch("change");
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
      // Tab from the last box goes on out of the words, as it would.
      if (event.key === "Enter" || i < count - 1) {
        event.preventDefault();
      }

      takeSuggestion(i, suggestions[active]);
    } else if (key === "close") {
      event.preventDefault();
      suggesting = -1;
    } else if ((event.key === "Enter" || event.key === " ") && values[i]) {
      event.preventDefault();
      moveOn(i);
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

    if (i === suggesting) {
      suggesting = -1;
    }

    if (!grid.contains(/** @type {Node | null} */ (event.relatedTarget))) {
      problem = problemNow();
    }
  }

  // As on the Restore page before: only where a page can read what's copied.
  const canPaste =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.readText === "function";

  /** What's copied, put in the boxes as a paste into the first box is. */
  async function pasteCopied() {
    try {
      const words = wordsOf(await navigator.clipboard.readText());

      if (words.length) {
        clearCopied();
        takeWords(0, words);
      }
    } catch (refusal) {
      toast(
        "error",
        refusal instanceof Error && refusal.name === "NotAllowedError"
          ? "Clipboard access denied"
          : String(refusal instanceof Error ? refusal.message : refusal),
        mdiAlertOutline,
      );
    }
  }

  /** @param {number} next 12 or 24 */
  function setCount(next) {
    count = next;
    suggesting = -1;

    for (let i = count; i < MAX; i++) {
      values[i] = "";
      marked[i] = false;
    }

    problem = "";
    dispatch("change");
  }

  /** Whether the words are hidden, as the page was: until Show words. */
  let isHidden = false;

  /** Whether Hold to show words is held, on a phone. */
  let isHeld = false;

  onMount(() =>
    onPageHidden(() => {
      // The suggestions say what's typed, a phone's too: gone with the page,
      // and offered again as typing goes on.
      suggesting = -1;

      // On a phone the words are masked anyway.
      if (values.some(Boolean) && !$touchOnly) {
        isHidden = true;
      }
    }),
  );

  $: shown = values.slice(0, count);
  // Masked as a password is: on a phone, but while they're held to show.
  $: isMasked = $touchOnly ? !isHeld : isHidden;
  // None while the words are hidden on a computer: they'd say what's typed.
  // On a phone they're kept, masked or not: typed unseen, they're how a
  // word is checked.
  $: suggestions =
    ($touchOnly || !isHidden) && suggesting >= 0
      ? suggestionsFor(values[suggesting])
      : [];
  // The phrase as the list spells it: a word typed with an accent too.
  $: mnemonic = shown.filter(Boolean).map(listWord).join(" ");
  $: isValid =
    shown.every(Boolean) && !phraseProblem(shown, { pasted: overflow });
  $: said = problem || error;
</script>

<div class="mnemonic-input">
  <div class="mnemonic-input__top">
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
    {#if isHidden && !$touchOnly}
      <Button
        on:click={() => {
          isHidden = false;
        }}
        text="Show words"
        variant="secondary"
      />
    {:else if canPaste}
      <Button
        aria-label="Paste recovery phrase"
        {disabled}
        icon={{ path: mdiContentPaste }}
        on:click={pasteCopied}
        text="Paste"
        variant="tertiary"
      />
    {/if}
  </div>
  <p class="mnemonic-input__hint" id="{id}-hint">
    Paste all words into any box.
  </p>
  <div
    aria-describedby={said ? `${id}-hint ${id}-problem` : `${id}-hint`}
    aria-label={label}
    bind:this={grid}
    class="mnemonic-input__grid"
    class:mnemonic-input__grid--hidden={isMasked}
    on:focusout={handleFocusOut}
    role="group"
  >
    {#each shown as word, i (i)}
      {@const isSuggesting = suggesting === i && suggestions.length > 0}
      <div class="mnemonic-input__cell">
        <label
          class="mnemonic-input__word"
          class:mnemonic-input__word--marked={marked[i]}
        >
          <span aria-hidden="true" class="mnemonic-input__index">{i + 1}</span>
          <input
            aria-activedescendant={isSuggesting
              ? optionId(`${id}-suggestions`, suggestions[active])
              : undefined}
            aria-autocomplete="list"
            aria-controls={isSuggesting ? `${id}-suggestions` : undefined}
            aria-describedby={marked[i] ? `${id}-not-${i}` : undefined}
            aria-expanded={isSuggesting}
            aria-invalid={marked[i] ? "true" : undefined}
            aria-label="Word {i + 1}"
            autocapitalize="none"
            autocomplete="off"
            autocorrect="off"
            bind:this={inputs[i]}
            {disabled}
            enterkeyhint={i === count - 1 ? "done" : "next"}
            inputmode="text"
            on:input={() => handleInput(i)}
            on:keydown={(event) => handleKeyDown(i, event)}
            on:paste={(event) => handlePaste(i, event)}
            readonly={$touchOnly && isHeld}
            role="combobox"
            spellcheck="false"
            type="text"
            value={word}
          />
        </label>
        {#if marked[i]}
          <span class="mnemonic-input__not" id="{id}-not-{i}">{NOT_A_WORD}</span
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
  {#if $touchOnly}
    <!-- Under the words: the thumb holding it hides none of them. -->
    <HoldToShow bind:held={isHeld} className="mnemonic-input__hold" />
  {/if}
  {#if said}
    <p class="mnemonic-input__problem" id="{id}-problem" role="alert">
      {said}
    </p>
  {/if}
  {#if isLeftCopied}
    <p class="mnemonic-input__hint" role="status">
      Your recovery phrase is still on the clipboard: copy something else over
      it.
    </p>
  {/if}
</div>

<style lang="postcss">
  .mnemonic-input {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .mnemonic-input__top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
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

  /* A box, what's said of its word under it, and its suggestions over what follows. */
  .mnemonic-input__cell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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

  /* Hidden, each box's word shows as a password does. */
  .mnemonic-input__grid--hidden .mnemonic-input__word input {
    -webkit-text-security: disc;
  }

  :global(.mnemonic-input__hold) {
    align-self: flex-start;
  }

  .mnemonic-input__problem {
    color: var(--calm-danger);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .mnemonic-input__not {
    padding: 0 0.75rem;
    color: var(--calm-danger);
    font-size: 0.75rem;
    line-height: 1.3;
  }
</style>
