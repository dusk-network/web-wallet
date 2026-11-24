import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { get } from "svelte/store";

import { dismissToasts, toast, toastList, toastTimer } from "../store";

// A toast's timer outlived the test that showed it, and could run once its
// page was gone: "window is not defined". Each test's end takes it away now
// (vite-setup.js), as dismissToasts does.
describe("Toasts", () => {
  // Each test on a clock of its own, whichever ran before it.
  beforeEach(() => {
    vi.useFakeTimers();
    toastTimer.set(5000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    toastTimer.set(0);
  });

  it("go once their time is up", () => {
    toast("info", "Copied", "");

    expect(get(toastList)).toHaveLength(1);

    vi.advanceTimersByTime(5000);

    expect(get(toastList)).toStrictEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("go at once when dismissed, with the timers that would have taken them", () => {
    toast("info", "Copied", "");
    toast("error", "Not sent", "", 60_000);

    expect(vi.getTimerCount()).toBe(2);

    dismissToasts();

    expect(get(toastList)).toStrictEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leave nothing behind for the next test: one shown and left as a test ends…", () => {
    toast("info", "Sent", "");

    expect(vi.getTimerCount()).toBe(1);
  });

  it("…is gone, with its timer, as the next begins", () => {
    expect(get(toastList)).toStrictEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
