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
 * the finger stays, and a press that ends a hold starts none.
 *
 * A screen reader can't hold: its double tap on a phone, or its Enter in
 * browse mode, is a click with no press of the button's own before it. Such
 * a click shows the words until it's pressed again, and every end a hold has
 * but letting go ends that too: another press on the page, the focus gone
 * anywhere but the button and the words it shows (its aria-controls), also
 * where the button never had it, the page out of sight, the minute.
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

  /**
   * Whether the button's own press, a finger's or a key's, came since its
   * last click: the click that follows it is the press's, never a toggle.
   * A key's press is held with its default prevented, so no browser clicks
   * after it: once it's let go, the next click is a screen reader's.
   */
  let pressed = false;

  /** What forgets a key's press once it's let go: see `pressed`. */
  let releasing = /** @type {ReturnType<typeof setTimeout> | undefined} */ (
    undefined
  );

  /** The button's own press: its click, if one follows, is the press's. */
  const pressedNow = () => {
    clearTimeout(releasing);
    pressed = true;
  };

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
      // Let go off the button, or taken away, as by a scroll: no click of
      // the press comes to it.
      if (
        event.type === "pointercancel" ||
        !(event.target instanceof Node && button.contains(event.target))
      ) {
        pressed = false;
      }

      end();
    }
  };

  /**
   * The words the button shows, as it says it controls them: the focus can
   * go to them while they show.
   */
  const words = () =>
    (button.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .flatMap((id) => (id ? (doc.getElementById(id) ?? []) : []));

  /**
   * The focus gone anywhere but the button and its words, or nowhere, also
   * where the button never had it: as the button's blur.
   *
   * @param {FocusEvent} event
   */
  const onFocusMove = (event) => {
    const to = event.type === "focusin" ? event.target : event.relatedTarget;

    if (
      !(to instanceof Node) ||
      !(button.contains(to) || words().some((each) => each.contains(to)))
    ) {
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
    ["focusin", onFocusMove, true],
    ["focusout", onFocusMove, true],
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
    pressedNow();

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
    pressedNow();

    // A key held on past the minute repeats: only a new press shows again.
    if (!isHeld && !event.repeat) {
      set(true);
    }
  }

  /** @param {KeyboardEvent} event */
  function keyUp(event) {
    if (isHoldKey(event)) {
      end();
      // No click comes of it: a browser that sent one would have by the
      // end of this task.
      clearTimeout(releasing);
      releasing = setTimeout(() => {
        pressed = false;
      });
    }
  }

  /** A long press is the hold, never the browser's menu. */
  const prevent = (/** @type {Event} */ event) => event.preventDefault();

  /** A press taken away, as by a scroll: no click comes of it. */
  function cancel() {
    pressed = false;
    end();
  }

  /**
   * A click: the end of the button's own press, which did all, or a screen
   * reader's, which shows the words, or hides them again.
   *
   * @param {Event} event
   */
  function click(event) {
    event.preventDefault();

    if (pressed) {
      pressed = false;
    } else {
      set(!isHeld);
    }
  }

  /** @type {Array<[string, (event: any) => void]>} */
  const own = [
    ["pointerdown", press],
    ["pointerup", end],
    ["pointercancel", cancel],
    ["lostpointercapture", end],
    ["blur", onFocusMove],
    ["keydown", keyDown],
    ["keyup", keyUp],
    ["contextmenu", prevent],
    ["click", click],
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
      clearTimeout(releasing);
      stopWatchingPage();

      for (const [type, listener] of own) {
        button.removeEventListener(type, listener);
      }
    },
  };
}
