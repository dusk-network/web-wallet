import { cubicIn, quartOut } from "svelte/easing";
import { prefersReducedMotion } from "svelte/motion";
import { fade, fly } from "svelte/transition";

/** @typedef {import("svelte/transition").TransitionConfig} TransitionConfig */

/**
 * Motion, as in every Dusk app and as the `--motion-*` tokens in
 * duskit-bridge.css: `fast` (ms) for feedback and every exit, `base` for
 * anything that arrives or opens, `ease` to arrive and `exit` to leave, and
 * never farther than `shift` (px).
 */
export const MOTION = Object.freeze({
  base: 200,
  ease: quartOut,
  exit: cubicIn,
  fast: 120,
  shift: 4,
});

/**
 * How long a button that sends, stakes, signs or approves ignores clicks
 * once its step shows, in ms: a double click on the button before it can't
 * land on it.
 */
export const CONFIRM_DELAY = 500;

/** How long a copy button says Copied, in ms. */
export const COPIED_FOR = 1500;

/**
 * Whether less motion was asked for, the one place that reads it: then
 * nothing travels or changes size, and opacity still changes.
 */
export const isReducedMotion = () => prefersReducedMotion.current;

/** @param {number} t */
const fadeCss = (t) => `opacity: ${t}`;

/**
 * With less motion: open at once, the content fading in over fast, and
 * close at once.
 *
 * @param {boolean} open
 * @returns {TransitionConfig}
 */
const atOnce = (open) =>
  open
    ? { css: fadeCss, duration: MOTION.fast, easing: MOTION.ease }
    : { duration: 0 };

/** @param {string} value */
const px = (value) => parseFloat(value) || 0;

/**
 * A section that opens and closes, as `transition:section={{ open }}`, with
 * `open` the state it goes to: it opens over base, its height and opacity
 * together, and closes over fast the same way back. The gap before it in a
 * column opens and closes with it.
 *
 * @param {Element} node
 * @param {{ open: boolean }} params
 * @returns {TransitionConfig}
 */
export function section(node, { open }) {
  if (isReducedMotion()) {
    return atOnce(open);
  }

  const style = getComputedStyle(node);
  const column = node.parentElement && getComputedStyle(node.parentElement);
  const gap =
    column &&
    (column.display.endsWith("grid") ||
      (column.display.endsWith("flex") &&
        column.flexDirection.startsWith("column")))
      ? px(column.rowGap)
      : 0;
  // The gap before it, or after it when it comes first.
  const gapBefore = node.previousElementSibling ? gap : 0;
  const gapAfter = !gapBefore && node.nextElementSibling ? gap : 0;
  const opacity = px(style.opacity);
  const height = px(style.height);
  const paddingTop = px(style.paddingTop);
  const paddingBottom = px(style.paddingBottom);
  const borderTop = px(style.borderTopWidth);
  const borderBottom = px(style.borderBottomWidth);
  const marginTop = px(style.marginTop);
  const marginBottom = px(style.marginBottom);

  return {
    css: (t) =>
      [
        "overflow: hidden",
        `opacity: ${t * opacity}`,
        `height: ${t * height}px`,
        "min-height: 0",
        `padding-top: ${t * paddingTop}px`,
        `padding-bottom: ${t * paddingBottom}px`,
        `border-top-width: ${t * borderTop}px`,
        `border-bottom-width: ${t * borderBottom}px`,
        `margin-top: ${t * marginTop - (1 - t) * gapBefore}px`,
        `margin-bottom: ${t * marginBottom - (1 - t) * gapAfter}px`,
      ].join(";"),
    duration: open ? MOTION.base : MOTION.fast,
    easing: open ? MOTION.ease : MOTION.exit,
  };
}

/**
 * A row's details in a panel beside the list, as
 * `transition:sidePanel={{ open }}`: they fade in over base and out over
 * fast, in place.
 *
 * @param {Element} node
 * @param {{ open: boolean }} params
 * @returns {TransitionConfig}
 */
export function sidePanel(node, { open }) {
  if (isReducedMotion()) {
    return atOnce(open);
  }

  return open
    ? { css: fadeCss, duration: MOTION.base, easing: MOTION.ease }
    : { css: fadeCss, duration: MOTION.fast, easing: MOTION.exit };
}

/**
 * A message arriving, as a toast: it fades in from shift below, over base.
 *
 * @param {Element} node
 * @returns {TransitionConfig}
 */
export const messageIn = (node) =>
  fly(node, {
    duration: MOTION.base,
    easing: MOTION.ease,
    y: isReducedMotion() ? 0 : MOTION.shift,
  });

/**
 * A message leaving: it fades out in place, over fast.
 *
 * @param {Element} node
 * @returns {TransitionConfig}
 */
export const messageOut = (node) =>
  fade(node, { duration: MOTION.fast, easing: MOTION.exit });

/**
 * How the messages left close up, as `animate:flip={closeUp()}`: over base,
 * or at once with less motion.
 */
export const closeUp = () => ({
  duration: isReducedMotion() ? 0 : MOTION.base,
  easing: MOTION.ease,
});
