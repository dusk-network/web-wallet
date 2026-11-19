import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import holdToShow, { HOLD_LONGEST_MS } from "../holdToShow";

/**
 * A pointer event as a browser gives it.
 *
 * @param {string} type
 * @param {Record<string, unknown>} [fields]
 */
const pointer = (type, fields = {}) =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    button: 0,
    pointerId: 1,
    pointerType: "touch",
    ...fields,
  });

describe("holdToShow", () => {
  /** @type {HTMLButtonElement} */
  let button;

  /** @type {boolean[]} */
  let told;

  /** @type {ReturnType<typeof holdToShow>} */
  let hold;

  const isShown = () => told.at(-1) === true;

  /** @param {Record<string, unknown>} [fields] */
  const press = (fields) =>
    button.dispatchEvent(pointer("pointerdown", fields));

  beforeEach(() => {
    button = document.createElement("button");
    document.body.append(button);
    told = [];
    hold = holdToShow(button, (isOn) => told.push(isOn));
  });

  afterEach(() => {
    hold.destroy();
    button.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Marek's and Chen's, in Firefox for Android: a hold cancelled rather than
  // released, and one held as the phone left the page, kept the words shown.
  it.each([
    ["let go", () => button.dispatchEvent(pointer("pointerup"))],
    [
      "let go off the button",
      () => document.body.dispatchEvent(pointer("pointerup")),
    ],
    [
      "taken away, as by a scroll",
      () => button.dispatchEvent(pointer("pointercancel")),
    ],
    [
      "its capture lost",
      () => button.dispatchEvent(pointer("lostpointercapture")),
    ],
    [
      "a second touch on the page",
      () =>
        document.body.dispatchEvent(pointer("pointerdown", { pointerId: 2 })),
    ],
    [
      "two fingers down",
      () =>
        document.body.dispatchEvent(
          Object.assign(new Event("touchstart", { bubbles: true }), {
            touches: [{}, {}],
          }),
        ),
    ],
    [
      "a menu over the page",
      () =>
        document.body.dispatchEvent(
          new Event("contextmenu", { bubbles: true, cancelable: true }),
        ),
    ],
    ["the button's focus gone", () => button.dispatchEvent(new Event("blur"))],
    ["the window's focus gone", () => window.dispatchEvent(new Event("blur"))],
    ["the page left", () => window.dispatchEvent(new Event("pagehide"))],
    [
      "the page out of sight, as Home or a call takes the phone",
      () => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      },
    ],
  ])("shows only while it's held: the hold ends %s", (_, end) => {
    press();

    expect(isShown()).toBe(true);

    end();

    expect(isShown()).toBe(false);
    expect(told).toStrictEqual([true, false]);
  });

  it("is the hold on its own long press, never the browser's menu, and toggles nothing on a click", () => {
    press();

    const menu = new Event("contextmenu", { bubbles: true, cancelable: true });
    const click = new Event("click", { bubbles: true, cancelable: true });

    button.dispatchEvent(menu);
    button.dispatchEvent(click);

    expect([menu.defaultPrevented, click.defaultPrevented]).toStrictEqual([
      true,
      true,
    ]);
    expect(isShown()).toBe(true);

    button.dispatchEvent(pointer("pointerup"));

    expect(isShown()).toBe(false);
  });

  // Amélie's, writing the words down: a thumb held still, of which Firefox
  // for Android tells the page nothing until it has moved about a millimetre.
  it("keeps the words while a thumb is held still, the page hearing nothing, until the hold is taken away or another finger touches", () => {
    vi.useFakeTimers();
    press();
    vi.advanceTimersByTime(5000);

    expect(isShown()).toBe(true);

    button.dispatchEvent(pointer("pointercancel"));

    expect(isShown()).toBe(false);

    press({ pointerId: 2 });
    vi.advanceTimersByTime(5000);

    expect(isShown()).toBe(true);

    document.body.dispatchEvent(pointer("pointerdown", { pointerId: 3 }));

    expect(told).toStrictEqual([true, false, true, false]);
  });

  // Marek's: Firefox told the page nothing of the hold's end once another
  // finger touched its toolbar. A minute at the most, then.
  it.each([
    [
      "by a finger",
      () => press(),
      () => document.body.dispatchEvent(pointer("pointermove")),
      () => button.dispatchEvent(pointer("pointerup")),
    ],
    [
      "by a mouse",
      () => press({ pointerType: "mouse" }),
      () =>
        document.body.dispatchEvent(
          pointer("pointermove", { pointerType: "mouse" }),
        ),
      () =>
        button.dispatchEvent(pointer("pointerup", { pointerType: "mouse" })),
    ],
    [
      "by a key",
      () =>
        button.dispatchEvent(
          new KeyboardEvent("keydown", { cancelable: true, key: " " }),
        ),
      () =>
        button.dispatchEvent(
          new KeyboardEvent("keydown", {
            cancelable: true,
            key: " ",
            repeat: true,
          }),
        ),
      () => button.dispatchEvent(new KeyboardEvent("keyup", { key: " " })),
    ],
  ])(
    "masks the words once one hold %s has lasted a minute, and shows them again when held again",
    (_, hold, goOn, letGo) => {
      vi.useFakeTimers();
      hold();
      vi.advanceTimersByTime(HOLD_LONGEST_MS - 1000);

      expect(isShown()).toBe(true);

      vi.advanceTimersByTime(2000);

      expect(isShown()).toBe(false);

      // Still held, it goes on: nothing shows.
      goOn();

      expect(isShown()).toBe(false);

      letGo();
      hold();

      expect(told).toStrictEqual([true, false, true]);
    },
  );

  it("ends a hold with a press on the button, which shows nothing; the one after it does", () => {
    press();
    press({ pointerId: 2 });

    expect(isShown()).toBe(false);

    button.dispatchEvent(pointer("pointerup", { pointerId: 2 }));
    press({ pointerId: 3 });

    expect(told).toStrictEqual([true, false, true]);
  });

  it("is held with the space bar or Enter too, and lets go with it", () => {
    button.dispatchEvent(
      new KeyboardEvent("keydown", { cancelable: true, key: " " }),
    );

    expect(isShown()).toBe(true);

    button.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));

    expect(isShown()).toBe(false);
  });

  it("listens to the page only while it's held, and to nothing once gone", () => {
    press();
    hold.destroy();

    expect(isShown()).toBe(false);

    press();
    document.body.dispatchEvent(pointer("pointerdown", { pointerId: 2 }));

    expect(told).toStrictEqual([true, false]);
  });
});
