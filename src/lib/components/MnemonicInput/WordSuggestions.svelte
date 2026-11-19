<svelte:options immutable={true} />

<script>
  /**
   * The recovery words a box suggests, as chips right under it: a listbox
   * the box controls, its highlighted word marked (`aria-selected`) and the
   * box's active descendant (`optionId`), as the keys are the box's. A tap
   * takes a word (`take`) and leaves the focus in the box, and a phone's
   * keyboard open. The chips scroll into view, above a phone's keyboard.
   */
  import { createEventDispatcher } from "svelte";

  import { optionId } from "./suggestions";

  /**
   * The listbox's id, which its box names.
   *
   * @type {string}
   */
  export let id;

  /** @type {string[]} */
  export let words;

  /** The highlighted word's place among them. */
  export let active = 0;

  const dispatch = createEventDispatcher();

  /**
   * Brings the chips into view as they change, once they're laid out: clear
   * of a phone's keyboard and of what sticks to the bottom (the document's
   * scroll padding).
   *
   * @param {HTMLElement} node
   * @param {string[]} shown
   */
  function inView(node, shown) {
    let frame = 0;

    /** @param {string[]} now */
    const show = (now) => {
      cancelAnimationFrame(frame);

      if (now.length) {
        frame = requestAnimationFrame(() =>
          node.scrollIntoView?.({ block: "nearest" }),
        );
      }
    };

    show(shown);

    return {
      destroy: () => cancelAnimationFrame(frame),
      update: show,
    };
  }
</script>

<!-- A press here takes a word, and moves no focus: the box keeps it. -->
<ul
  aria-label="Suggestions"
  class="word-suggestions"
  {id}
  on:mousedown|preventDefault
  role="listbox"
  use:inView={words}
>
  {#each words as word, i (word)}
    <!-- The box's keys choose, its active descendant the highlighted word. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <li
      aria-selected={i === active}
      class="word-suggestions__word"
      class:word-suggestions__word--active={i === active}
      id={optionId(id, word)}
      on:click={() => dispatch("take", word)}
      role="option"
    >
      {word}
    </li>
  {/each}
</ul>

<style lang="postcss">
  /* Over what follows, a flow's buttons as well, which stay at the bottom. */
  .word-suggestions {
    position: absolute;
    top: calc(100% + 0.375rem);
    left: 0;
    right: 0;
    z-index: 4;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0;
    padding: 0.375rem;
    border-radius: 1rem;
    background: var(--calm-panel);
    box-shadow:
      0 0 0 1px var(--calm-line2),
      0 12px 32px rgb(0 0 0 / 0.18);
    list-style: none;
  }

  /*
   * Two to a row where they fit, each a thumb's tap. The highlighted one,
   * which Enter and Tab take, has the focus's edge.
   */
  .word-suggestions__word {
    display: inline-flex;
    flex: 1 1 40%;
    align-items: center;
    justify-content: center;
    min-height: 2.75rem;
    padding: 0 0.625rem;
    border-radius: 999px;
    background: var(--calm-s2);
    color: var(--calm-text);
    font-size: 0.9375rem;
    cursor: pointer;
    user-select: none;

    &:hover {
      background: var(--calm-s3);
    }

    &--active {
      box-shadow: inset 0 0 0 2px var(--calm-focus);
    }
  }
</style>
