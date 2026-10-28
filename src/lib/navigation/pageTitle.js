import { derived, writable } from "svelte/store";

/** How many of a page's own titles are on screen. */
const titles = writable(0);

/**
 * Whether the page names itself with a heading of its own: the wallet then
 * leaves out the heading it gives every page for screen readers, so that
 * the page's name is one heading.
 */
export const pageHasTitle = derived(titles, (count) => count > 0);

/**
 * Marks a heading as the page's own title, while it's on screen and
 * `isTitle` holds.
 *
 * @param {HTMLElement} _node
 * @param {boolean} [isTitle]
 */
export default function pageTitle(_node, isTitle = true) {
  let counted = false;

  /** @param {boolean} on */
  const count = (on) => {
    if (on !== counted) {
      counted = on;
      titles.update((n) => n + (on ? 1 : -1));
    }
  };

  count(isTitle);

  return {
    destroy() {
      count(false);
    },
    /** @param {boolean} [on] */
    update(on = true) {
      count(on);
    },
  };
}
