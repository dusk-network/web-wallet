/**
 * Hold to show words, on a phone (touchOnly): recovery words show only while
 * this button is held, by a finger or a key, never at rest, so no picture a
 * phone's app switcher takes as the page is left has them, whenever it takes
 * it. As the extension's does in Firefox for Android, the hold ends the
 * moment it's let go or cut into, however: the press let go or taken away (a
 * scroll, a call), its pointer's capture lost, a second touch anywhere on the
 * page, a menu opening over it, the button's focus gone, the page out of
 * sight or its window's focus gone (onPageHidden), and at the latest once it
 * has lasted HOLD_LONGEST_MS; held again, they show again. A thumb held still
 * says nothing to the page (Firefox for Android drops its moves until it has
 * gone about a millimetre), so no silence ends a hold: Amélie would write the
 * words down so. A hold whose end a browser dropped without a word (Marek's,
 * in Firefox for Android: holding, then touching its toolbar with another
 * finger left all twelve words shown once both fingers were off) ends with
 * the next touch on the page, or the minute. A tap shows them for as long as
 * the finger stays; nothing toggles, and a press that ends a hold starts none.
 */

import onPageHidden from "./onPageHidden";

/** What the button says. */
export const HOLD_TO_SHOW_TEXT = "Hold to show words";

/**
 * The longest one hold shows the words, however it's held: a minute, time to
 * write them down; held again, they show again.
 */
export const HOLD_LONGEST_MS = 60_000;

/**
 * @param {KeyboardEvent} event
 */
const isHoldKey = ({ key }) => key === " " || key === "Enter";

/**
 * Shows while `button` is held: `show(true)` as it's pressed, `show(false)`
 * as soon as the hold ends or is cut into.
 *
 * @param {HTMLElement} button
 * @param {(isShown: boolean) => void} show
 */
export default function holdToShow(button, show) {
  let tell = show;
  let isHeld = false;

  /** The pointer holding it: null for a key. */
  let pointer = /** @type {number | null} */ (null);

  /** What ends the hold once it has lasted HOLD_LONGEST_MS. */
  let longest = /** @type {ReturnType<typeof setTimeout> | undefined} */ (
    undefined
  );

  /** The press that began the hold, and the one that last ended one. */
  let began = /** @type {Event | null} */ (null);
  let cut = /** @type {Event | null} */ (null);

  const doc = button.ownerDocument;

  const end = () => set(false);

  /** @param {Event} event */
  const onPagePress = (event) => {
    if (event !== began) {
      cut = event;
      end();
    }
  };

  /** @param {PointerEvent} event */
  const onPageEnd = (event) => {
    if (event.pointerId === pointer) {
      end();
    }
  };

  /** @param {TouchEvent} event */
  const onTouches = (event) => {
    if ((event.touches?.length ?? 0) > 1) {
      end();
    }
  };

  /** A menu over the page, which nothing stopped: the button's own is. */
  const onMenu = (/** @type {Event} */ event) => {
    if (!event.defaultPrevented) {
      end();
    }
  };

  /**
   * What the page hears while it's held, wherever on it: another press, the
   * held pointer's end, two fingers down, or a menu.
   *
   * @type {Array<[string, (event: any) => void, boolean]>}
   */
  const pageListeners = [
    ["pointerdown", onPagePress, true],
    ["pointerup", onPageEnd, true],
    ["pointercancel", onPageEnd, true],
    ["touchstart", onTouches, true],
    ["contextmenu", onMenu, false],
  ];

  /** @param {boolean} on */
  function listen(on) {
    for (const [type, listener, capture] of pageListeners) {
      if (on) {
        doc.addEventListener(type, listener, {
          capture,
          passive: type === "touchstart",
        });
      } else {
        doc.removeEventListener(type, listener, { capture });
      }
    }
  }

  /** @param {boolean} on */
  function set(on) {
    if (isHeld === on) {
      return;
    }

    isHeld = on;
    listen(on);
    clearTimeout(longest);

    if (on) {
      longest = setTimeout(end, HOLD_LONGEST_MS);
    } else {
      pointer = null;
      began = null;
    }

    tell(on);
  }

  /** @param {PointerEvent} event */
  function press(event) {
    if (event.button > 0) {
      return;
    }

    event.preventDefault();

    // A second touch, or the first after a hold whose end the page never
    // heard: that hold is over, and this press shows nothing.
    if (isHeld || event === cut) {
      cut = event;
      end();

      return;
    }

    try {
      button.setPointerCapture?.(event.pointerId);
    } catch {
      // Let go off the button: its pointerup still comes as the page's.
    }

    pointer = event.pointerId;
    began = event;
    set(true);
  }

  /** @param {KeyboardEvent} event */
  function keyDown(event) {
    if (!isHoldKey(event)) {
      return;
    }

    event.preventDefault();

    // A key held on past the minute repeats: only a new press shows again.
    if (!isHeld && !event.repeat) {
      set(true);
    }
  }

  /** @param {KeyboardEvent} event */
  function keyUp(event) {
    if (isHoldKey(event)) {
      end();
    }
  }

  /** A long press is the hold, never the browser's menu; a click toggles nothing. */
  const prevent = (/** @type {Event} */ event) => event.preventDefault();

  /** @type {Array<[string, (event: any) => void]>} */
  const own = [
    ["pointerdown", press],
    ["pointerup", end],
    ["pointercancel", end],
    ["lostpointercapture", end],
    ["blur", end],
    ["keydown", keyDown],
    ["keyup", keyUp],
    ["contextmenu", prevent],
    ["click", prevent],
  ];

  for (const [type, listener] of own) {
    button.addEventListener(type, listener);
  }

  const stopWatchingPage = onPageHidden(end);

  return {
    /** @param {(isShown: boolean) => void} next */
    update(next) {
      tell = next;
    },

    destroy() {
      end();
      stopWatchingPage();

      for (const [type, listener] of own) {
        button.removeEventListener(type, listener);
      }
    },
  };
}
