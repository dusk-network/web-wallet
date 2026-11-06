import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import {
  NOTICE_WORDS,
  arrivalNoticeState,
  arrivalSeen,
  arrivalTitle,
  chooseArrivalNotice,
  followsWhileAway,
  forgetArrivalTitle,
  noticeWords,
  stopArrivalNotice,
  transferEnded,
} from "../arrivalNotice";
import { networks } from "@dusk-network/networks";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { followArrivals } from "../arrivalFollowing";

const stores = vi.hoisted(() => ({
  /** @type {any} */
  deposits: null,
  /** @type {any} */
  transfers: null,
  /** @type {any} */
  withdrawals: null,
}));

const mocks = vi.hoisted(() => ({
  followRouteTransfers: vi.fn(() => () => {}),
  goto: vi.fn(),
  resumeRecentDeposits: vi.fn(),
  resumeUnsettledWithdrawals: vi.fn(),
}));

vi.mock("../routeHistory", async () => {
  const { writable: makeStore } = await import("svelte/store");

  stores.transfers = makeStore([]);

  return { FOLLOW_FOR_MS: 86_400_000, routeTransfers: stores.transfers };
});

vi.mock("../depositActivity", async () => {
  const { writable: makeStore } = await import("svelte/store");

  stores.deposits = makeStore([]);

  return {
    depositActivityStore: stores.deposits,
    resumeRecentDeposits: mocks.resumeRecentDeposits,
  };
});

vi.mock("../withdrawalTracking", async () => {
  const { writable: makeStore } = await import("svelte/store");

  stores.withdrawals = makeStore([]);

  return {
    resumeUnsettledWithdrawals: mocks.resumeUnsettledWithdrawals,
    withdrawalActivityStore: stores.withdrawals,
  };
});

vi.mock("../routeFollowing", () => ({
  followRouteTransfers: mocks.followRouteTransfers,
}));

vi.mock("$lib/navigation", () => ({ goto: mocks.goto }));

/** A browser that can notify, as `answer` says, with what it showed. */
function browser({ answer = "granted", permission = "default" } = {}) {
  /** @type {any[]} */
  const shown = [];
  const asked = vi.fn();

  class Stand {
    static permission = permission;

    static async requestPermission() {
      asked();
      Stand.permission = answer;

      return answer;
    }

    /**
     * @param {string} title
     * @param {any} options
     */
    constructor(title, options) {
      shown.push({ options, title });
      this.close = vi.fn();
      Stand.last = this;
    }

    /** @type {any} */
    static last = null;
  }

  vi.stubGlobal("Notification", Stand);

  return { Stand, asked, shown };
}

/**
 * A browser that notifies through a service worker, as a phone's does: what
 * the worker showed, what it was registered with, and its message to the
 * page as a notification is pressed.
 */
function withWorker() {
  /** @type {any[]} */
  const shown = [];
  const registered = vi.fn();
  const events = new EventTarget();

  class Registration {
    /**
     * @param {string} title
     * @param {any} options
     */
    async showNotification(title, options) {
      shown.push({ options, title });
    }
  }

  const registration = new Registration();

  vi.stubGlobal("ServiceWorkerRegistration", Registration);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      ready: Promise.resolve(registration),
      async register(/** @type {any[]} */ ...args) {
        registered(...args);

        return registration;
      },
      removeEventListener: events.removeEventListener.bind(events),
    },
  });

  return {
    /** @param {string} url */
    press: (url) =>
      events.dispatchEvent(
        new MessageEvent("message", { data: { type: "arrival-open", url } })
      ),
    registered,
    shown,
  };
}

/** A phone's browser, by what it says it is. */
const onPhone = () =>
  vi
    .spyOn(navigator, "userAgent", "get")
    .mockReturnValue("Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36");

/**
 * Whether they're looking at the page.
 *
 * @param {boolean} looking
 */
const lookingAtPage = (looking) => {
  vi.spyOn(document, "hasFocus").mockReturnValue(looking);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(
    looking ? "visible" : "hidden"
  );
};

describe("Being told when a transfer arrives", () => {
  beforeEach(() => {
    localStorage.clear();
    stopArrivalNotice();
    forgetArrivalTitle();
    lookingAtPage(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
    localStorage.clear();
  });

  it("asks nothing of the browser until they press for it", () => {
    const { asked, shown } = browser();

    stopArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("offer");
    expect(followsWhileAway()).toBe(false);

    transferEnded({ id: "a", title: "1 DUSK arrived on Dusk" });

    expect(asked).not.toHaveBeenCalled();
    expect(shown).toStrictEqual([]);
  });

  it("notifies once they chose it, of what ends while they're away, and opens where it says when it's pressed", async () => {
    const { Stand, asked, shown } = browser();
    const onOpen = vi.fn();

    await chooseArrivalNotice();

    expect(asked).toHaveBeenCalledOnce();
    expect(get(arrivalNoticeState)).toBe("on");
    expect(followsWhileAway()).toBe(true);

    transferEnded({ id: "a", onOpen, title: "1 DUSK arrived on Dusk" });

    await vi.waitFor(() =>
      expect(shown).toMatchObject([
        { options: { tag: "a" }, title: "1 DUSK arrived on Dusk" },
      ])
    );

    Stand.last.onclick();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(Stand.last.close).toHaveBeenCalledOnce();
  });

  it("stays chosen on this device, until it's turned off", async () => {
    const { shown } = browser();

    await chooseArrivalNotice();
    stopArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("offer");

    transferEnded({ id: "a", title: "1 DUSK arrived on Dusk" });

    expect(shown).toStrictEqual([]);
  });

  it("leaves whoever is looking at the page to see it there: no notification, and the title as it is", async () => {
    const { shown } = browser();

    await chooseArrivalNotice();
    lookingAtPage(true);
    transferEnded({ id: "a", title: "1 DUSK arrived on Dusk" });

    expect(shown).toStrictEqual([]);
    expect(get(arrivalTitle)).toBe("");
  });

  it("says what ended in the tab's title, chosen or not, until they're back", () => {
    browser();

    transferEnded({ id: "a", title: "1 DUSK arrived on Dusk" });

    expect(get(arrivalTitle)).toBe("1 DUSK arrived on Dusk");

    arrivalSeen();

    expect(get(arrivalTitle)).toBe("1 DUSK arrived on Dusk");

    lookingAtPage(true);
    arrivalSeen();

    expect(get(arrivalTitle)).toBe("");
  });

  it("says the title will tell where the browser refuses, and follows on", async () => {
    browser({ answer: "denied" });

    await chooseArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("refused");
    expect(followsWhileAway()).toBe(true);
  });

  it("offers a notification on a phone through the wallet's service worker, saying it comes while the tab stays open, and opens what arrived as it's pressed", async () => {
    browser();
    onPhone();

    const worker = withWorker();

    stopArrivalNotice();

    // Offered, with what it can't do: it's the open page that tells.
    expect(get(arrivalNoticeState)).toBe("offer");
    expect(noticeWords("offer")).toBe("while this tab stays open");
    expect(worker.registered).not.toHaveBeenCalled();

    await chooseArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("on");
    expect(noticeWords("on")).toBe(
      "You'll get a notification when it arrives, while this tab stays open."
    );
    expect(worker.registered).toHaveBeenCalledExactlyOnceWith(
      "/some-base-path/service-worker.js",
      expect.objectContaining({ scope: "/some-base-path/" })
    );

    const stop = followArrivals();

    transferEnded({
      href: "/dashboard/bridge/transactions?tx=ff",
      id: "a",
      title: "1 DUSK arrived on Dusk",
    });

    await vi.waitFor(() =>
      expect(worker.shown).toMatchObject([
        {
          options: {
            data: {
              url: `${location.origin}/some-base-path/dashboard/bridge/transactions?tx=ff`,
            },
            tag: "a",
          },
          title: "1 DUSK arrived on Dusk",
        },
      ])
    );

    // Pressed: the wallet goes to what arrived, and only to its own pages.
    worker.press(
      `${location.origin}/some-base-path/dashboard/bridge/transactions?tx=ff`
    );
    worker.press("https://elsewhere.example/some-base-path/dashboard");

    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
      "/dashboard/bridge/transactions?tx=ff"
    );
    stop();
    mocks.goto.mockClear();
  });

  it("offers no notification on a phone that can't give one, which shows no tab's title either: the screen says it there; where a browser has none, the title says it", async () => {
    browser({ answer: "denied" });
    onPhone();
    stopArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("phone");
    expect(NOTICE_WORDS.phone).toBe("This screen says when it arrives.");
    expect(followsWhileAway()).toBe(true);

    // Refused on a phone that could, it says where it's said instead.
    withWorker();
    await chooseArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("refused");
    expect(noticeWords("refused")).toBe(
      "Notifications aren't allowed for this site, so this screen says when it arrives."
    );

    vi.restoreAllMocks();
    lookingAtPage(false);
    vi.stubGlobal("Notification", undefined);
    stopArrivalNotice();

    expect(get(arrivalNoticeState)).toBe("unavailable");
  });

  it("still says it in the title where notifying from a page throws", async () => {
    const { Stand } = browser();

    await chooseArrivalNotice();
    vi.stubGlobal(
      "Notification",
      Object.assign(
        function () {
          throw new TypeError("Illegal constructor");
        },
        { permission: Stand.permission }
      )
    );
    stopArrivalNotice();
    localStorage.setItem(
      `${CONFIG.LOCAL_STORAGE_APP_KEY}-arrival-notice`,
      "on"
    );

    expect(() =>
      transferEnded({ id: "a", title: "1 DUSK arrived on Dusk" })
    ).not.toThrow();
    expect(get(arrivalTitle)).toBe("1 DUSK arrived on Dusk");
  });

  describe("watching the transfers", () => {
    /** @type {() => void} */
    let stop;

    const route = {
      chain: { name: "BSC" },
      destination: "bsc",
      origin: "duskDs",
    };
    const service = (/** @type {string} */ stage) => ({
      amountLux: 3_000_000_000n,
      feeLux: 1_000_000_000n,
      hash: "aa",
      kind: "service",
      route,
      stage,
    });

    beforeEach(() => {
      browser();
      stores.transfers.set([]);
      stores.deposits.set([]);
      stores.withdrawals.set([]);
      stop = followArrivals();
    });

    afterEach(() => stop());

    it("says what arrived, from a change alone: not what had ended as it was first seen", () => {
      stores.transfers.set([{ ...service("arrived"), hash: "old" }]);

      expect(get(arrivalTitle)).toBe("");

      stores.transfers.set([service("sent")]);

      expect(get(arrivalTitle)).toBe("");

      stores.transfers.set([service("arrived")]);

      expect(get(arrivalTitle)).toBe("2 DUSK arrived on BSC");
    });

    it("says a transfer that didn't go through, and a deposit and a withdrawal at each step that asks something", () => {
      stores.transfers.set([service("sent")]);
      stores.transfers.set([{ ...service("failed"), failure: "No" }]);

      expect(get(arrivalTitle)).toBe("It didn't go through");

      const deposit = {
        amountLux: "250000000",
        stage: "l1_pending",
        transactionHash: "dd",
      };

      stores.deposits.set([deposit]);
      stores.deposits.set([{ ...deposit, stage: "completed" }]);

      expect(get(arrivalTitle)).toBe("0.25 DUSK arrived on DuskEVM");

      const withdrawal = {
        amountWei: "1000000000000000000",
        stage: "waiting_for_output",
        transactionHash: "ee",
      };

      stores.withdrawals.set([withdrawal]);
      stores.withdrawals.set([{ ...withdrawal, stage: "ready_to_prove" }]);

      expect(get(arrivalTitle)).toBe("Ready to prove on Dusk");

      stores.withdrawals.set([{ ...withdrawal, stage: "ready_to_finalize" }]);

      expect(get(arrivalTitle)).toBe("Ready to claim on Dusk");

      stores.withdrawals.set([{ ...withdrawal, stage: "finalized" }]);

      expect(get(arrivalTitle)).toBe("1 DUSK arrived on Dusk");
    });

    it("opens the transfer's activity from its notification", async () => {
      const { Stand } = browser();

      await chooseArrivalNotice();
      stores.transfers.set([service("sent")]);
      stores.transfers.set([service("arrived")]);
      await vi.waitFor(() => expect(Stand.last).not.toBeNull());
      Stand.last.onclick();

      expect(mocks.goto).toHaveBeenCalledWith(
        "/dashboard/bridge/transactions?tx=aa"
      );
    });

    it("takes up what's under way on DuskEVM again, from whichever page the wallet opens on, once they asked: no bridge screen needed", async () => {
      const { Stand } = browser();

      setNodeNetwork(networks.testnet);
      stop();
      mocks.resumeRecentDeposits.mockClear();
      mocks.resumeUnsettledWithdrawals.mockClear();
      stop = followArrivals();

      expect(mocks.resumeRecentDeposits).not.toHaveBeenCalled();
      expect(mocks.resumeUnsettledWithdrawals).not.toHaveBeenCalled();

      await chooseArrivalNotice();

      expect(mocks.resumeRecentDeposits).toHaveBeenCalledOnce();
      expect(mocks.resumeUnsettledWithdrawals).toHaveBeenCalledOnce();

      // Chosen before: as the wallet unlocks on another page, or reloads.
      stop();
      stop = followArrivals();

      expect(mocks.resumeRecentDeposits).toHaveBeenCalledTimes(2);
      expect(mocks.resumeUnsettledWithdrawals).toHaveBeenCalledTimes(2);

      // And for a network without DuskEVM, nothing.
      setNodeNetwork(null);
      stop();
      stop = followArrivals();

      expect(mocks.resumeRecentDeposits).toHaveBeenCalledTimes(2);
      expect(Stand.permission).toBe("granted");
    });

    it("follows what's under way from wherever the wallet is only once they asked, and says nothing of it once locked", async () => {
      mocks.followRouteTransfers.mockClear();
      stop();
      stop = followArrivals();

      expect(mocks.followRouteTransfers).not.toHaveBeenCalled();

      await chooseArrivalNotice();

      expect(mocks.followRouteTransfers).toHaveBeenCalledExactlyOnceWith({
        recentOnly: true,
      });

      stores.transfers.set([service("sent")]);
      stores.transfers.set([service("arrived")]);

      expect(get(arrivalTitle)).not.toBe("");

      stop();

      expect(get(arrivalTitle)).toBe("");

      stop = followArrivals();
    });
  });
});
