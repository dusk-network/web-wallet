/** The fields one types in. */
export const TYPING_FIELDS =
  "textarea, select, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])";

/**
 * Keeps `--keyboard-inset` on the node, and on the document for its scroll
 * padding, at the height a phone's keyboard covers at the bottom of the
 * window, from the visual viewport: what sticks to the bottom stays above
 * the keyboard.
 *
 * When the window's height changes, as when the keyboard opens, the field
 * being typed in is brought back into view, clear of what sticks to the
 * bottom: the document's scroll padding keeps that room, which scrolling a
 * field into view takes, but the browser's own scroll on a resize doesn't.
 *
 * @param {HTMLElement} node
 */
export default function keyboardInset(node) {
  const viewport = window.visualViewport;

  if (!viewport) {
    return {};
  }

  const root = document.documentElement;

  /** @type {number | undefined} */
  let frame;

  const keepFieldInView = () => {
    const field = document.activeElement;

    if (
      field instanceof HTMLElement &&
      node.contains(field) &&
      field.matches(TYPING_FIELDS)
    ) {
      cancelAnimationFrame(frame ?? 0);
      // Once the layout has taken the new height.
      frame = requestAnimationFrame(() => {
        if (document.activeElement === field) {
          field.scrollIntoView({ block: "nearest" });
        }
      });
    }
  };

  const update = () => {
    const inset = `${Math.max(
      0,
      Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
    )}px`;

    node.style.setProperty("--keyboard-inset", inset);
    root.style.setProperty("--keyboard-inset", inset);
  };

  const resize = () => {
    update();
    keepFieldInView();
  };

  viewport.addEventListener("resize", resize);
  viewport.addEventListener("scroll", update);
  update();

  return {
    destroy() {
      cancelAnimationFrame(frame ?? 0);
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
    },
  };
}
