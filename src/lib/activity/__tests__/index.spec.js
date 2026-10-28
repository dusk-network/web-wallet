import { afterEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import fixture from "./fixtures/activity-testnet.json";
import { fakeArchive } from "./fixtures/fakeArchive";
import { activityFor, activityState, currentActivity, stopActivity } from "..";

const [A, B] = Object.keys(fixture.accounts);
const NODE = fixture.nodeUrl;

/** @param {string} account */
const optionsFor = (account) => ({
  account,
  namesNetwork: "testnet",
  nodeUrl: NODE,
  profileIndex: 0,
});

afterEach(() => {
  stopActivity();
  vi.unstubAllGlobals();
});

describe("activityFor", () => {
  it("keeps one history session, for the account shown, and its state", async () => {
    fakeArchive();

    const first = activityFor(optionsFor(A));

    expect(activityFor(optionsFor(A))).toBe(first);
    await first.start();
    expect(get(activityState).rows.length).toBeGreaterThan(0);

    const listener = vi.fn();

    first.subscribe(listener);
    listener.mockClear();

    const second = activityFor(optionsFor(B));

    expect(second).not.toBe(first);
    expect(currentActivity()).toBe(second);

    // The first one stopped: it tells nobody anything any more.
    await first.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it("forgets the session and its rows when stopped, as for a lock", async () => {
    fakeArchive();
    await activityFor(optionsFor(A)).start();

    stopActivity();

    expect(currentActivity()).toBeNull();
    expect(get(activityState)).toMatchObject({ loaded: false, rows: [] });
  });
});
