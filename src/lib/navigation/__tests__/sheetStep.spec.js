import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addBasePath, sheetStep } from "..";

const stores = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable: makeStore } = await import("svelte/store");

  stores.page = makeStore({ state: {}, url: new URL(location.href) });

  return { navigating: makeStore(null), page: stores.page };
});

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock("$lib/navigation/goto", () => ({ default: mocks.goto }));

describe("sheetStep", () => {
  /** @type {import("vitest").MockInstance} */
  let back;

  /**
   * The tab at an address, with the state its step in the history gave it.
   *
   * @param {string} href
   * @param {any} [state]
   */
  const at = (href, state = {}) =>
    stores.page?.set({
      state,
      url: new URL(addBasePath(href), location.origin),
    });

  /** The tab as the last step left it, at the address it went to. */
  const stepped = () => {
    const [href, { state }] = mocks.goto.mock.lastCall ?? [];

    at(href, state);
  };

  /**
   * The tab at a list, then each sheet given, a step of its own.
   *
   * @param {...string} sheets
   */
  function steppedThrough(...sheets) {
    at("/list");

    sheets.forEach((href, sheet) => {
      sheetStep(href, sheet, sheet + 1);
      stepped();
    });
    mocks.goto.mockClear();
  }

  beforeEach(() => {
    at("/list");
    back = vi.spyOn(history, "go").mockImplementation(() => {});
    mocks.goto.mockClear();
  });

  afterEach(() => {
    back.mockRestore();
  });

  it("takes a step of its own to open a sheet, for Back to close", () => {
    sheetStep("/list?open=1", 0, 1);

    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
      "/list?open=1",
      expect.objectContaining({ keepFocus: true, noScroll: true })
    );
    expect(mocks.goto.mock.lastCall?.[1]).not.toHaveProperty("replaceState");
    expect(back).not.toHaveBeenCalled();

    // And another for a form over it.
    stepped();
    sheetStep("/list?open=1&edit=1", 1, 2);

    expect(mocks.goto).toHaveBeenLastCalledWith(
      "/list?open=1&edit=1",
      expect.objectContaining({ keepFocus: true, noScroll: true })
    );
    expect(mocks.goto.mock.lastCall?.[1]).not.toHaveProperty("replaceState");
  });

  it("closes a sheet it stepped to by taking the step back, as many as it closes", () => {
    steppedThrough("/list?open=1", "/list?open=1&edit=1");

    sheetStep("/list?open=1", 2, 1);

    expect(back).toHaveBeenCalledExactlyOnceWith(-1);

    back.mockClear();
    sheetStep("/list", 2, 0);

    expect(back).toHaveBeenCalledExactlyOnceWith(-2);
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it("goes where it's asked from a form to another sheet: back only to the sheet asked for", () => {
    steppedThrough("/list?open=A", "/list?open=A&edit=1");

    // Contact B, or a new one, from contact A's form.
    sheetStep("/list?open=B", 2, 1);

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
      "/list?open=B",
      expect.objectContaining({
        keepFocus: true,
        noScroll: true,
        replaceState: true,
      })
    );

    // Closing what it went to still goes back to the list.
    stepped();
    mocks.goto.mockClear();
    sheetStep("/list", 1, 0);

    expect(back).toHaveBeenCalledExactlyOnceWith(-2);
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it("goes where it's asked once what's behind a sheet changed: a list filtered since keeps its filter", () => {
    steppedThrough("/list?kind=sent&open=1");

    // Another filter, with the sheet open.
    sheetStep("/list?kind=received&open=1", 1, 1);
    stepped();
    mocks.goto.mockClear();

    sheetStep("/list?kind=received", 1, 0);

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
      "/list?kind=received",
      expect.objectContaining({ replaceState: true })
    );
  });

  it("closes in place a sheet it didn't step to, as from a link: nothing's behind it", () => {
    at("/list?open=1");
    sheetStep("/list", 1, 0);

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
      "/list",
      expect.objectContaining({
        keepFocus: true,
        noScroll: true,
        replaceState: true,
      })
    );
  });

  it("stays on the step it's on going from a sheet to another, or changing what's behind it", () => {
    steppedThrough("/list?open=1");
    sheetStep("/list?open=2", 1, 1);

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
      "/list?open=2",
      expect.objectContaining({
        keepFocus: true,
        noScroll: true,
        replaceState: true,
      })
    );
  });
});
