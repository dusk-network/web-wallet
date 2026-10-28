import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import keyboardInset from "../keyboardInset";

describe("keyboardInset", () => {
  /** A visual viewport, as a phone's keyboard resizes it. */
  const viewport = Object.assign(new EventTarget(), {
    height: 0,
    offsetTop: 0,
  });

  /** @type {HTMLElement} */
  let node;

  /** @param {number} keyboard The height the keyboard covers */
  const openKeyboard = (keyboard) => {
    viewport.height = window.innerHeight - keyboard;
    viewport.dispatchEvent(new Event("resize"));
  };

  /**
   * A focused element, its scrolling followed.
   *
   * @param {HTMLElement} element
   * @param {HTMLElement} [into]
   */
  const focused = (element, into = node) => {
    const scroll = vi.fn();

    element.scrollIntoView = scroll;
    into.append(element);
    element.focus();

    return scroll;
  };

  beforeEach(() => {
    viewport.height = window.innerHeight;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((run) => {
      run(0);

      return 1;
    });
    node = document.createElement("div");
    document.body.append(node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "visualViewport");
    document.body.replaceChildren();
  });

  it("should keep the height the keyboard covers on the node, and on the document for its scroll padding", () => {
    const action = keyboardInset(node);

    expect(node.style.getPropertyValue("--keyboard-inset")).toBe("0px");

    openKeyboard(300);

    expect(node.style.getPropertyValue("--keyboard-inset")).toBe("300px");
    expect(
      document.documentElement.style.getPropertyValue("--keyboard-inset")
    ).toBe("300px");

    action.destroy?.();

    expect(
      document.documentElement.style.getPropertyValue("--keyboard-inset")
    ).toBe("");
  });

  it("should bring the field typed in back into view when the window's height changes, as the keyboard opens", () => {
    keyboardInset(node);

    const memo = focused(document.createElement("textarea"));

    openKeyboard(300);

    expect(memo).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });

    // And as the window narrows, as on a rotated phone.
    viewport.dispatchEvent(new Event("resize"));

    expect(memo).toHaveBeenCalledTimes(2);
  });

  it("should leave the page where it is while no field in it is typed in", () => {
    keyboardInset(node);

    for (const [element, into] of [
      [document.createElement("button"), node],
      [
        Object.assign(document.createElement("input"), { type: "checkbox" }),
        node,
      ],
      [document.createElement("input"), document.body],
    ]) {
      const scroll = focused(element, into);

      openKeyboard(300);
      openKeyboard(0);

      expect(scroll).not.toHaveBeenCalled();
    }
  });
});
