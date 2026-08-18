import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import startInactivityTimer from "../startInactivityTimer";

describe("startInactivityTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should expire after the configured period without activity", async () => {
    const onInactive = vi.fn();

    startInactivityTimer(onInactive, 1_000);

    await vi.advanceTimersByTimeAsync(999);
    expect(onInactive).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onInactive).toHaveBeenCalledTimes(1);
  });

  it.each(["keydown", "pointerdown", "wheel"])(
    "should restart the deadline on %s activity",
    async (event) => {
      const onInactive = vi.fn();

      startInactivityTimer(onInactive, 1_000);
      await vi.advanceTimersByTimeAsync(900);
      window.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(999);

      expect(onInactive).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onInactive).toHaveBeenCalledTimes(1);
    }
  );

  it("should enforce an elapsed deadline when browser timers were delayed", () => {
    const onInactive = vi.fn();

    startInactivityTimer(onInactive, 1_000);
    vi.setSystemTime(1_000);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onInactive).toHaveBeenCalledTimes(1);
  });

  it("should not let late activity renew an elapsed deadline", () => {
    const onInactive = vi.fn();

    startInactivityTimer(onInactive, 1_000);
    vi.setSystemTime(1_000);
    window.dispatchEvent(new Event("pointerdown"));

    expect(onInactive).toHaveBeenCalledTimes(1);
  });

  it("should stop tracking activity when disposed", async () => {
    const onInactive = vi.fn();
    const stop = startInactivityTimer(onInactive, 1_000);

    stop();
    window.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(onInactive).not.toHaveBeenCalled();
  });
});
