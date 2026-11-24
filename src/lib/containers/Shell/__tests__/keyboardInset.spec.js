import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import keyboardInset from "../keyboardInset";

/**
 * A phone's visual viewport, as the browser gives it: `height` and `scale`
 * as the test sets them.
 */
class Viewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}

describe("keyboardInset", () => {
  /** @type {Viewport} */
  let viewport;

  /** @type {HTMLElement} */
  let node;

  /** @type {HTMLInputElement} */
  let field;

  /** @type {ReturnType<typeof keyboardInset>} */
  let action;

  const inset = () => node.style.getPropertyValue("--keyboard-inset");

  /** Once a frame has passed, as after focus has gone where it goes. */
  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));

  beforeEach(() => {
    viewport = new Viewport();
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    node = document.createElement("div");
    field = document.createElement("input");
    node.append(field, document.createElement("button"));
    document.body.append(node);
    action = keyboardInset(node);
  });

  afterEach(() => {
    action.destroy?.();
    node.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // An in-app browser's toolbars and sheets, as X's, make the visual
  // viewport shorter as the page scrolls, with no keyboard.
  it("counts nothing where the visual viewport is shorter but no field has the focus", () => {
    viewport.height = 610;
    viewport.dispatchEvent(new Event("resize"));

    expect(inset()).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue("--keyboard-inset"),
    ).toBe("0px");

    viewport.dispatchEvent(new Event("scroll"));

    expect(inset()).toBe("0px");
  });

  it("counts what the keyboard covers while a field one types in has the focus, and nothing once it's left", async () => {
    viewport.height = 450;
    field.focus();
    await nextFrame();

    expect(inset()).toBe("350px");

    viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event("scroll"));

    expect(inset()).toBe("330px");

    /** @type {HTMLButtonElement} */ (node.querySelector("button")).focus();
    await nextFrame();

    expect(inset()).toBe("0px");
  });

  // A tap on the button moves the focus to it before it clicks: the bar,
  // moved at once, would leave the click to what was under it.
  it("keeps the bar where it is until the focus has moved, so that a tap on its button clicks it", async () => {
    const button = /** @type {HTMLButtonElement} */ (
      node.querySelector("button")
    );

    viewport.height = 450;
    field.focus();
    await nextFrame();
    button.focus();

    expect(inset()).toBe("350px");

    await nextFrame();

    expect(inset()).toBe("0px");
  });

  it("keeps the keyboard's inset as the focus goes from one field to the next", async () => {
    const next = document.createElement("textarea");

    node.append(next);
    viewport.height = 450;
    field.focus();
    next.focus();
    await nextFrame();

    expect(inset()).toBe("350px");
  });

  it("counts nothing while the page is pinch-zoomed, a field focused or not", async () => {
    viewport.height = 400;
    viewport.scale = 2;
    viewport.dispatchEvent(new Event("resize"));

    expect(inset()).toBe("0px");

    field.focus();
    await nextFrame();

    expect(inset()).toBe("0px");

    // Back at its own scale, within a hundredth.
    viewport.scale = 1.005;
    viewport.height = 450;
    viewport.dispatchEvent(new Event("resize"));

    expect(inset()).toBe("350px");
  });
});
