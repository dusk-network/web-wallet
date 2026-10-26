/**
 * Keeps `--keyboard-inset` on the node at the height a phone's keyboard
 * covers at the bottom of the window, from the visual viewport: what sticks
 * to the bottom stays above the keyboard.
 *
 * @param {HTMLElement} node
 */
export default function keyboardInset(node) {
  const viewport = window.visualViewport;

  if (!viewport) {
    return {};
  }

  const update = () => {
    const inset = Math.max(
      0,
      Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
    );

    node.style.setProperty("--keyboard-inset", `${inset}px`);
  };

  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();

  return {
    destroy() {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    },
  };
}
