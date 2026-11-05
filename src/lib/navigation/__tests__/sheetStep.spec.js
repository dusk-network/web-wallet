import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sheetStep } from "..";

const stores = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable: makeStore } = await import("svelte/store");

  stores.page = makeStore({ state: {} });

  return { navigating: makeStore(null), page: stores.page };
});

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock("$lib/navigation/goto", () => ({ default: mocks.goto }));

describe("sheetStep", () => {
  /** @type {import("vitest").MockInstance} */
  let back;

  /** @param {any} state */
  const at = (state) => stores.page?.set({ state });

  beforeEach(() => {
    at({});
    back = vi.spyOn(history, "go").mockImplementation(() => {});
    mocks.goto.mockClear();
  });

  afterEach(() => {
    back.mockRestore();
  });

  it("takes a step of its own to open a sheet, for Back to close", () => {
    sheetStep("/list?open=1", 0, 1);

    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith("/list?open=1", {
      keepFocus: true,
      noScroll: true,
      state: { sheets: 1 },
    });
    expect(back).not.toHaveBeenCalled();

    // And another for a form over it.
    at({ sheets: 1 });
    sheetStep("/list?open=1&edit=1", 1, 2);

    expect(mocks.goto).toHaveBeenLastCalledWith("/list?open=1&edit=1", {
      keepFocus: true,
      noScroll: true,
      state: { sheets: 2 },
    });
  });

  it("closes a sheet it stepped to by taking the step back, as many as it closes", () => {
    at({ sheets: 2 });

    sheetStep("/list?open=1", 2, 1);

    expect(back).toHaveBeenCalledExactlyOnceWith(-1);

    back.mockClear();
    sheetStep("/list", 2, 0);

    expect(back).toHaveBeenCalledExactlyOnceWith(-2);
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it("closes in place a sheet it didn't step to, as from a link: nothing's behind it", () => {
    sheetStep("/list", 1, 0);

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith("/list", {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
      state: { sheets: 0 },
    });
  });

  it("stays on the step it's on going from a sheet to another, or changing what's behind it", () => {
    at({ sheets: 1 });
    sheetStep("/list?open=2", 1, 1);

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith("/list?open=2", {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
      state: { sheets: 1 },
    });
  });
});
