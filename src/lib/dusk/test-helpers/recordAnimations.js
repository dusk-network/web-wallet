/**
 * @typedef {{
 *   duration: number,
 *   element: Element,
 *   finish: () => void,
 *   keyframes: Keyframe[],
 * }} AnimationRun
 *   An animation the browser was asked to run: on what, its frames, how
 *   long it takes, and a way to end it.
 */

/**
 * Records each animation the page asks the browser to run, as Svelte's
 * transitions do, and keeps it running until the test finishes it: jsdom
 * runs none, so this is how a test sees what moves, how, and what happens
 * once it has. What takes no time ends at once.
 *
 * @returns {{ restore: () => void, runs: AnimationRun[] }}
 */
export default function recordAnimations() {
  const original = Element.prototype.animate;

  /** @type {AnimationRun[]} */
  const runs = [];

  /**
   * @this {Element}
   * @param {Keyframe[] | PropertyIndexedKeyframes | null} keyframes
   * @param {number | KeyframeAnimationOptions} [options]
   */
  function animate(keyframes, options) {
    /** @type {(() => void) | null} */
    let onfinish = null;
    let isFinished = false;
    const duration = Number(
      typeof options === "number" ? options : (options?.duration ?? 0)
    );

    /** @type {AnimationRun} */
    const run = {
      duration,
      element: this,
      finish() {
        if (!isFinished) {
          isFinished = true;
          onfinish?.();
        }
      },
      keyframes: Array.isArray(keyframes) ? keyframes : [],
    };

    if (duration) {
      runs.push(run);
    }

    return /** @type {Animation} */ (
      /** @type {unknown} */ ({
        cancel() {
          isFinished = true;
        },
        currentTime: 0,
        effect: null,
        /** @param {() => void} callback */
        set onfinish(callback) {
          onfinish = callback;

          if (!duration) {
            run.finish();
          }
        },
        playState: "running",
      })
    );
  }

  Element.prototype.animate = animate;

  return {
    restore() {
      Element.prototype.animate = original;
    },
    runs,
  };
}
