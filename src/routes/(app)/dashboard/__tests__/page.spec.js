import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import {
  NOT_CONFIRMED_YET,
  lastReadText,
  shortAddress,
  timeLabel,
} from "$lib/activity/present";
import { removeContact, saveContact } from "$lib/contacts";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { settingsStore } from "$lib/stores";

import Dashboard from "../+page.svelte";
import { networks } from "@dusk-network/networks";

const mocks = vi.hoisted(() => ({
  activityRefresh: vi.fn(() => Promise.resolve()),
  readMissing: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
  refreshBalance: vi.fn(() => Promise.resolve()),
}));

const network = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  store: null,
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");
  const { networks: files } = await import("@dusk-network/networks");

  network.store = writable({
    connected: true,
    net: files.mainnet,
    networkName: "mainnet",
  });

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      subscribe: network.store.subscribe,
    },
    walletStore: {
      ...mockedWalletStore,
      refreshBalance: mocks.refreshBalance,
      startHistory: () => ({
        readMissing: mocks.readMissing,
        refresh: mocks.refresh,
      }),
    },
  };
});

const history = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  state: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  /** @type {typeof import("$lib/activity")} */
  const original = await importOriginal();
  const { derived, writable } = await import("svelte/store");

  history.state = writable({
    complete: true,
    error: null,
    hasMore: false,
    loaded: true,
    rows: [],
    syncing: false,
  });

  return {
    ...original,
    activityState: history.state,
    currentActivity: () => ({ refresh: mocks.activityRefresh }),
    // All of the history: the page shown.
    wholeActivity: derived(history.state, ({ rows }) => ({
      failed: false,
      reading: false,
      rows,
      whole: true,
    })),
  };
});

const sozu = vi.hoisted(() => ({
  load: vi.fn(() => Promise.resolve()),
  /** @type {import("svelte/store").Writable<any> | null} */
  store: null,
}));

vi.mock("$lib/sozu", async (importOriginal) => {
  /** @type {typeof import("$lib/sozu")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  sozu.store = writable({
    account: "",
    available: true,
    error: null,
    loading: false,
    status: null,
  });

  return {
    ...original,
    sozuStore: {
      load: sozu.load,
      reset: () => {},
      subscribe: sozu.store.subscribe,
    },
  };
});

const ALICE =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const OTHER =
  "21KL9R1h2CWF4Su1RGkf6MucN92yUKMRKgBE4gns9mV1r8BW46APhvBBVX4Ut7f5Zxf639KTZUb2zanB4UZiYsEJkzkwoNJ1GQuKKPBNQkUGKwKq5iudjQJ2UiQFHZ71rMvN";
const NOW = Date.now();

// Sent from here, on its way; received; and failed.
const FIELDS = [
  {
    amount: "5000000000",
    hash: "a1".repeat(32),
    privacy: "public",
    source: "local",
    status: "submitted",
    submittedAt: NOW,
    to: ALICE,
    toName: "alice-shop.dusk",
  },
  {
    amount: "50000000000",
    blockHeight: 4_687_000,
    counterpartyName: "wallet-both.dusk",
    direction: "in",
    from: ALICE,
    hash: "b2".repeat(32),
    status: "executed",
    timestamp: NOW - 60_000,
  },
  {
    amount: "200000000000",
    blockHeight: 4_686_000,
    feePaid: "3700000",
    hash: "c3".repeat(32),
    status: "failed",
    timestamp: NOW - 120_000,
    to: ALICE,
  },
];
const rows = FIELDS.map((fields) => rowOf(fields));

/** @param {Partial<import("$lib/activity/activitySession").ActivityState>} state */
const setHistory = (state) =>
  act(() => history.state?.update((current) => ({ ...current, ...state })));

/**
 * Text that names each of `values`, in any order, whatever its words: a
 * string whole, so `0.01 DUSK` is never found in `10.01 DUSK`; a regex as
 * the key phrase of a state; and `{ not }` as what it never says.
 *
 * @param {...(string | RegExp | { not: RegExp })} values
 */
const naming = (...values) =>
  expect.stringMatching(
    new RegExp(
      `^${values
        .map((value) =>
          typeof value === "string"
            ? `(?=.*(?<![\\w.,])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w))`
            : value instanceof RegExp
              ? `(?=.*(?${value.flags.includes("i") ? "i" : ""}:${value.source}))`
              : `(?!.*(?${value.not.flags.includes("i") ? "i" : ""}:${value.not.source}))`,
        )
        .join("")}`,
    ),
  );

/** @param {Element | null | undefined} element */
const textOf = (element) => element?.textContent?.replace(/\s+/g, " ").trim();

/** The total balance Home shows, as its figure reads. */
const totalOf = () => textOf(document.querySelector(".home-balance__amount"));

/** What the total says of what it counts that couldn't be read. */
const unreadOf = () => textOf(document.querySelector(".home-balance__unread"));

/** What the total is worth in money, as it reads. */
const fiatOf = () => textOf(document.querySelector(".home-balance__fiat"));

/**
 * The parts of the total, as its legend gives them, each by its key: public,
 * shielded and staked.
 */
const partsOf = () =>
  Object.fromEntries(
    Array.from(document.querySelectorAll(".home-balance__key"), (key) => [
      key.className.match(/home-balance__key--(\w+)/)?.[1],
      textOf(key.parentElement?.querySelector("b")),
    ]),
  );

/**
 * A balance card, by its label's key word: its figure, as its value reads,
 * and the notes under it.
 *
 * @param {RegExp} label
 */
const cardOf = (label) => {
  const card = Array.from(document.querySelectorAll(".explainer-card")).find(
    (each) =>
      label.test(textOf(each.querySelector(".explainer-card__key")) ?? ""),
  );

  return {
    notes: Array.from(
      card?.querySelectorAll(".explainer-card__text") ?? [],
      textOf,
    ),
    value: textOf(card?.querySelector(".explainer-card__value")),
  };
};

/**
 * The sends Home says are waiting: each as its banner says it, its controls
 * aside, and what it offers, by its controls' names.
 */
const waitingBanners = () =>
  Array.from(document.querySelectorAll(".home__waiting"), (banner) => {
    const said = /** @type {Element} */ (banner.cloneNode(true));

    said.querySelectorAll("button").forEach((button) => button.remove());

    return {
      offers: Array.from(banner.querySelectorAll("button"), (button) =>
        button.textContent?.trim(),
      ),
      says: textOf(said),
    };
  });

/*
 * Where a waiting send is, as its banner says it: by the key phrase of that
 * state, what it never says then, and what it offers, by its controls' names.
 */

/**
 * It waits for the network, nothing having left the wallet: Waiting, going
 * out once the network answers, to call off.
 */
const WAITING = {
  offers: ["Don't send"],
  says: [
    /\bwaiting\b/i,
    /goes out once the network answers/i,
    { not: /sending/i },
  ],
};

/** It's being sent, the node asked to check it: to call off still. */
const SENDING = {
  offers: ["Don't send"],
  says: [/\bsending\b/i, { not: /not sent|waiting/i }],
};

/** Handed over to be broadcast: being sent, with nothing to call off. */
const HANDED_OVER = {
  offers: [],
  says: [/\bsending\b/i, { not: /not sent|waiting/i }],
};

/**
 * Held as its account sent something else while it waited: Held, not sent,
 * to send it too, or not.
 */
const HELD = {
  offers: ["Send it too", "Don't send"],
  says: [/your account sent/i, /\bheld\b/i, { not: /sending|waiting/i }],
};

/**
 * A waiting send's banner, as in `state`, that names each of `values`.
 *
 * @param {{ offers: string[], says: Array<RegExp | { not: RegExp }> }} state
 * @param {...(string | RegExp | { not: RegExp })} values
 */
const waitingAs = ({ offers, says }, ...values) => ({
  offers,
  says: naming(...says, ...values),
});

describe("Dashboard", () => {
  const usdPrice = 0.5;
  const props = {
    data: { currentPrice: Promise.resolve({ usd: usdPrice }) },
  };
  const initialStore = mockedWalletStore.getMockedStoreValue();

  afterEach(async () => {
    cleanup();
    settingsStore.reset();
    mockedWalletStore.setMockedStoreValue(initialStore);
    sozu.store?.set({
      account: "",
      available: true,
      error: null,
      loading: false,
      status: null,
    });
    await setHistory({ error: null, loaded: true, rows: [], syncing: false });
  });

  afterAll(() => {
    vi.doUnmock("$lib/stores");
    vi.doUnmock("$lib/activity");
    vi.doUnmock("$lib/sozu");
  });

  it("says a send waits to go out while the network doesn't answer, with Don't send, wherever it was sent from, until it goes out, each with its memo and time to tell them apart", async () => {
    const { keepWaiting, sendGate, waitingSends } =
      await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");
    const { toastList } = await import("$lib/dusk/components/Toast/store");

    toastList.set([]);
    render(Dashboard, props);

    const first = sendGate();
    const second = sendGate();
    const answered = Promise.withResolvers();

    keepWaiting({
      gate: first,
      lux: 10_000_000n,
      memo: "ward round 1",
      operation: new Promise(() => {}),
      to: "Profile 2",
    });
    keepWaiting({
      gate: second,
      lux: 10_000_000n,
      memo: "ward round 2",
      operation: answered.promise,
      to: "Profile 2",
    });

    // When each was sent, as Home says it.
    const [one, two] = get(waitingSends).map(({ at }) => timeLabel(at, "en"));

    try {
      await act(() => setNetworkReach("silent"));

      expect(waitingBanners()).toStrictEqual([
        waitingAs(WAITING, "0.01 DUSK", "Profile 2", "ward round 1", one),
        waitingAs(WAITING, "0.01 DUSK", "Profile 2", "ward round 2", two),
      ]);

      // Called off from here: nothing goes out, and it's said.
      await fireEvent.click(
        /** @type {HTMLElement} */ (
          document.querySelector(".home__waiting button")
        ),
      );

      expect(get(first)).toBe("cancelled");
      expect(waitingBanners()).toStrictEqual([
        waitingAs(WAITING, "0.01 DUSK", "Profile 2", "ward round 2", two),
      ]);
      expect(get(toastList).map(({ message }) => message)).toContainEqual(
        naming(/nothing left/i, "0.01 DUSK", "Profile 2"),
      );

      // The other goes out once the network answers: being sent, with
      // nothing to call off, until the node took it.
      await act(() => setNetworkReach("answering"));
      await act(() => second.handOver());

      expect(waitingBanners()).toStrictEqual([
        waitingAs(HANDED_OVER, "0.01 DUSK", "Profile 2", "ward round 2", two),
      ]);

      answered.resolve(undefined);

      await vi.waitFor(() => expect(waitingBanners()).toStrictEqual([]));
    } finally {
      first.cancel();
      second.cancel();
      answered.resolve(undefined);
      setNetworkReach("answering");
    }
  });

  // Then M19's: "Not sent yet … It's being sent. Cancel" as it went out.
  // One state at a time: Sending as it goes out, Not sent yet while it waits
  // for the network, and nothing once the node took it, as Activity has it.
  it("says a send goes out as it does, and that one that couldn't reach the network goes out once it answers, while the pill still finds it answering", async () => {
    const { keepWaiting, sendGate, waitingSends } =
      await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");

    render(Dashboard, props);

    const gate = sendGate();
    const answered = Promise.withResolvers();

    keepWaiting({
      gate,
      lux: 10_000_000n,
      operation: answered.promise,
      to: "Profile 2",
    });

    const at = timeLabel(get(waitingSends)[0].at, "en");

    try {
      await act(() => setNetworkReach("answering"));

      expect(waitingBanners()).toStrictEqual([
        waitingAs(SENDING, "0.01 DUSK", "Profile 2", at),
      ]);

      // The node can't be reached as it's sent: it waits for the network,
      // nothing having left, and can still be called off.
      gate
        .untilHandedOver(
          () => Promise.reject(new TypeError("Failed to fetch")),
          () => new Promise(() => {}),
        )
        .catch(() => {});
      await vi.waitFor(() =>
        expect(waitingBanners()).toStrictEqual([
          waitingAs(WAITING, "0.01 DUSK", "Profile 2", at),
        ]),
      );

      // Handed over: being sent, with nothing to call off, until the node
      // took it, and then no longer said here.
      await act(() => gate.handOver());

      expect(waitingBanners()).toStrictEqual([
        waitingAs(HANDED_OVER, "0.01 DUSK", "Profile 2", at),
      ]);

      answered.resolve(undefined);

      await vi.waitFor(() => expect(waitingBanners()).toStrictEqual([]));
    } finally {
      gate.cancel();
      answered.resolve(undefined);
      setNetworkReach("answering");
    }
  });

  // Chen's, on slow Wi-Fi: "Not sent yet … It goes out once the network
  // answers. Cancel" for 30 s while the node checked it and took it. Then
  // Lena's: no Cancel while the node's check hung, though nothing had left.
  it("says a waiting send is being sent from the moment the node is asked to check it, though the pill finds the network silent, with Don't send until it's handed over", async () => {
    const { keepWaiting, sendGate, waitingSends } =
      await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");

    render(Dashboard, props);

    const gate = sendGate();
    const answered = Promise.withResolvers();

    keepWaiting({
      gate,
      lux: 10_000_000n,
      operation: answered.promise,
      to: "your Profile 2",
    });

    const at = timeLabel(get(waitingSends)[0].at, "en");

    try {
      await act(() => setNetworkReach("silent"));

      expect(waitingBanners()).toStrictEqual([
        waitingAs(WAITING, "0.01 DUSK", "your Profile 2", at),
      ]);

      // The node is asked to check it: being sent, its answer slow, and can
      // still be called off.
      await act(() => gate.checking());

      expect(waitingBanners()).toStrictEqual([
        waitingAs(SENDING, "0.01 DUSK", "your Profile 2", at),
      ]);

      // Handed over: being sent, with nothing to call off, until the node
      // took it, and then no longer said here, as Activity has it.
      await act(() => gate.handOver());

      expect(waitingBanners()).toStrictEqual([
        waitingAs(HANDED_OVER, "0.01 DUSK", "your Profile 2", at),
      ]);

      answered.resolve(undefined);

      await vi.waitFor(() => expect(waitingBanners()).toStrictEqual([]));
    } finally {
      gate.cancel();
      answered.resolve(undefined);
      setNetworkReach("answering");
    }
  });

  // Chen's, on two phones: the payment waiting on phone A went out by itself
  // after she paid the same from phone B. Held, it says so here, with the
  // payment, and goes only as she says. Then, as Send it too paid at once,
  // twice: it goes to Send's review, as Send it now does.
  it("says a waiting send whose account sent something else meanwhile is held, with the payment, and takes it to Send's review with Send it too, or doesn't send it, only as the person says", async () => {
    const { keepWaiting, sendGate, takeUnsentRefill, waitingSends } =
      await import("$lib/transactions");
    const { toastList } = await import("$lib/dusk/components/Toast/store");
    const { currentProfile } = mockedWalletStore.getMockedStoreValue();
    const account = String(currentProfile.account);

    toastList.set([]);
    render(Dashboard, props);

    /** @param {string} name */
    const button = (name) =>
      /** @type {HTMLElement} */ (
        Array.from(document.querySelectorAll(".home__waiting button")).find(
          (each) => each.textContent?.trim() === name,
        )
      );

    /**
     * A send that waited, held as the person is asked.
     *
     * @param {string} memo
     */
    async function held(memo) {
      const gate = sendGate();
      let goesOn = false;

      keepWaiting({
        address: ALICE,
        gate,
        kept: {
          account,
          isSaid: () => true,
          network: "mainnet",
          typed: { amount: "0.01", memo, to: ALICE },
        },
        lux: 10_000_000n,
        memo,
        operation: new Promise(() => {}),
        to: "your Profile 2",
      });
      gate.ask().then(
        () => {
          goesOn = true;
        },
        () => {},
      );
      await act();

      return { gate, goesOn: () => goesOn };
    }

    const sent = await held("night shift 6");

    try {
      const at = timeLabel(get(waitingSends)[0].at, "en");

      expect(waitingBanners()).toStrictEqual([
        waitingAs(HELD, "0.01 DUSK", "your Profile 2", "night shift 6", at),
      ]);

      // Send it too: to Send's review, filled in with it, to send from
      // there; never sent from here.
      await fireEvent.click(button("Send it too"));

      expect(get(sent.gate)).toBe("cancelled");
      expect(sent.goesOn()).toBe(false);
      expect(waitingBanners()).toStrictEqual([]);
      expect(takeUnsentRefill({ account, network: "mainnet" })).toMatchObject({
        lux: "10000000",
        memo: "night shift 6",
        sentElsewhere: true,
        to: ALICE,
        typed: { amount: "0.01", memo: "night shift 6", to: ALICE },
      });
    } finally {
      sent.gate.cancel();
    }

    const dropped = await held("night shift 7");

    try {
      // Don't send: called off, nothing goes out, and it's said.
      await fireEvent.click(button("Don't send"));

      expect(get(dropped.gate)).toBe("cancelled");
      expect(dropped.goesOn()).toBe(false);
      expect(waitingBanners()).toStrictEqual([]);
      expect(get(toastList)).toContainEqual(
        expect.objectContaining({
          message: naming(/nothing left/i, "0.01 DUSK", "your Profile 2"),
          type: "info",
        }),
      );
    } finally {
      dropped.gate.cancel();
    }
  });

  // Marek's, Lena's and Chen's: the hold called the very same payment
  // "something else", said nothing of what was sent or when, and Activity
  // didn't list it for minutes.
  it("names what the account sent while a held send waited, from the chain, says it looks like the same payment where it is, and has Activity read again", async () => {
    const { keepWaiting, sendGate, waitingSends } =
      await import("$lib/transactions");
    const { Network } = await import("@dusk/w3sper");
    const { shortenAddress } = await import("$lib/dusk/string");
    const { currentProfile } = mockedWalletStore.getMockedStoreValue();
    const account = String(currentProfile.account);
    const sentAt = Date.now() - 30_000;
    const hex = (/** @type {string} */ text) =>
      Array.from(new TextEncoder().encode(text), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    // The archive lists what the account sent meanwhile: the same payment.
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockImplementation(async (/** @type {string | undefined} */ gql) => {
        const text = String(gql);

        if (text.startsWith("block(height: -1)")) {
          return { block: { header: { height: 4_881_400 } } };
        }

        if (text.startsWith("out: moonlightHistory(")) {
          return {
            out: {
              json: [
                {
                  block_height: 4_881_399,
                  events: [
                    {
                      data: {
                        memo: hex("night shift 9"),
                        receiver: ALICE,
                        sender: account,
                        value: "10000000",
                      },
                      // The transfer contract's, which says what it paid.
                      target: "01".padEnd(64, "0"),
                      topic: "moonlight",
                    },
                  ],
                  origin: "9a".repeat(32),
                },
              ],
            },
          };
        }

        if (text.startsWith("t0: tx(")) {
          return {
            t0: {
              blockTimestamp: sentAt / 1000,
              tx: { json: JSON.stringify({ nonce: 1234, sender: account }) },
            },
          };
        }

        throw new Error("Not asked here");
      });

    mocks.activityRefresh.mockClear();
    render(Dashboard, props);

    const gate = sendGate();

    keepWaiting({
      address: ALICE,
      gate,
      kept: {
        account,
        isSaid: () => true,
        network: "mainnet",
        typed: { amount: "0.01", memo: "night shift 9", to: ALICE },
      },
      lux: 10_000_000n,
      memo: "night shift 9",
      operation: new Promise(() => {}),
      to: "Alice",
    });

    const at = timeLabel(get(waitingSends)[0].at, "en");

    gate.ask({ account, from: 1233n, to: 1234n }).catch(() => {});

    try {
      // Held: what was sent, to whom and when, that it looks like this same
      // payment, and the send held.
      await vi.waitFor(() =>
        expect(waitingBanners()).toStrictEqual([
          waitingAs(
            HELD,
            /looks like this payment/i,
            shortenAddress(ALICE),
            timeLabel(sentAt, "en"),
            "0.01 DUSK",
            "Alice",
            "night shift 9",
            at,
          ),
        ]),
      );
      // Read again as it was held, and as what was sent was found.
      expect(mocks.activityRefresh).toHaveBeenCalledTimes(2);
    } finally {
      gate.cancel();
      query.mockRestore();
    }
  });

  // Chen's and Marek's: "Your account sent something else" for the first
  // eight to ten seconds, Send it too live, of what was the same payment.
  it("says it's checking what the account sent while that's read, its answers off, and after a moment what's known, its answers on", async () => {
    const { keepWaiting, sendGate } = await import("$lib/transactions");
    const { CHECKING_FOR_MS, CHECKING_TEXT, forgetSentMeanwhile } =
      await import("$lib/transactions/sentMeanwhile");
    const { Network } = await import("@dusk/w3sper");
    const { currentProfile } = mockedWalletStore.getMockedStoreValue();
    const account = String(currentProfile.account);
    /** @type {PromiseWithResolvers<void>} */
    const answers = Promise.withResolvers();
    // The node answers once let; the archive doesn't list it yet.
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockImplementation(async (/** @type {string | undefined} */ gql) => {
        await answers.promise;

        return String(gql).startsWith("block(height: -1)")
          ? { block: { header: { height: 4_881_400 } } }
          : { out: { json: [] } };
      });

    render(Dashboard, props);

    const gate = sendGate();
    const buttons = () =>
      Array.from(
        document.querySelectorAll(".home__waiting button"),
        (button) => [
          button.textContent?.trim(),
          /** @type {HTMLButtonElement} */ (button).disabled,
        ],
      );

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    keepWaiting({
      address: ALICE,
      gate,
      kept: {
        account,
        isSaid: () => true,
        network: "mainnet",
        typed: { amount: "0.01", memo: "night shift 10", to: ALICE },
      },
      lux: 10_000_000n,
      memo: "night shift 10",
      operation: new Promise(() => {}),
      to: "Alice",
    });
    gate.ask({ account, from: 1300n, to: 1301n }).catch(() => {});

    try {
      await act();

      expect(waitingBanners()).toStrictEqual([
        waitingAs(HELD, CHECKING_TEXT, "0.01 DUSK", "night shift 10"),
      ]);
      expect(buttons()).toStrictEqual([
        ["Send it too", true],
        ["Don't send", true],
      ]);

      // Not found within a moment: what's known, and the answers on.
      answers.resolve();
      await act(() => vi.advanceTimersByTimeAsync(CHECKING_FOR_MS));

      expect(waitingBanners()).toStrictEqual([
        waitingAs(
          HELD,
          /something else/i,
          { not: /checking/i },
          "0.01 DUSK",
          "night shift 10",
        ),
      ]);
      expect(buttons()).toStrictEqual([
        ["Send it too", false],
        ["Don't send", false],
      ]);
    } finally {
      gate.cancel();
      query.mockRestore();
      vi.useRealTimers();
      forgetSentMeanwhile();
    }
  });

  it("hides a waiting send's amount once balances are hidden, though they weren't as it was sent, there and as it's called off", async () => {
    const { keepWaiting, sendGate } = await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");
    const { toastList } = await import("$lib/dusk/components/Toast/store");
    toastList.set([]);
    render(Dashboard, props);

    const gate = sendGate();

    keepWaiting({
      gate,
      lux: 10_000_000n,
      operation: new Promise(() => {}),
      to: "Profile 2",
    });

    try {
      await act(() => setNetworkReach("silent"));

      expect(waitingBanners()).toStrictEqual([
        waitingAs(WAITING, "0.01 DUSK", "Profile 2"),
      ]);

      await act(() =>
        settingsStore.update((store) => ({ ...store, hideBalances: true })),
      );

      expect(waitingBanners()).toStrictEqual([
        waitingAs(WAITING, "Profile 2", { not: /0\.01/ }),
      ]);

      await fireEvent.click(
        /** @type {HTMLElement} */ (
          document.querySelector(".home__waiting button")
        ),
      );

      // Said as it's called off, its amount hidden too.
      const messages = get(toastList).map(({ message }) => message);

      expect(get(gate)).toBe("cancelled");
      expect(messages).toContainEqual(naming(/nothing left/i, "Profile 2"));
      expect(
        messages.filter((message) => message.includes("0.01")),
      ).toStrictEqual([]);
    } finally {
      gate.cancel();
      setNetworkReach("answering");
    }
  });

  it("shows the total balance, everything held, its parts, and its value in money", async () => {
    render(Dashboard, props);

    // 1,172.5 public, 2,345 shielded and 1,000 staked.
    expect(totalOf()).toBe("4,517.5");
    expect(partsOf()).toStrictEqual({
      public: "1,172.5",
      shielded: "2,345",
      staked: "1,000",
    });

    // About so much, at the price read.
    await vi.waitFor(() => expect(fiatOf()).toBe("≈ $2,258.75"));
  });

  it("shows no value in money off mainnet, as test DUSK has none", async () => {
    network.store?.set({
      connected: true,
      net: networks.testnet,
      networkName: "testnet",
    });

    const { container } = render(Dashboard, props);

    await props.data.currentPrice;
    await act(() => {});

    expect(container.querySelector(".home-balance__fiat")).toBeNull();

    network.store?.set({
      connected: true,
      net: networks.mainnet,
      networkName: "mainnet",
    });
  });

  it("shows what is staked with Sozu, for the profile shown only", async () => {
    const { currentProfile } = initialStore;

    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });
    render(Dashboard, props);

    await act(() =>
      sozu.store?.set({
        account: String(currentProfile.account),
        available: true,
        error: null,
        loading: false,
        status: {
          contracts: {},
          pool: { stake: 3n, supply: 1n },
          position: { balance: 1_500_000_000_000n, stDusk: 487_000_000_000n },
        },
      }),
    );

    expect(cardOf(/stak/i).value).toMatch(/^1,500 DUSK\b/);

    // Another profile's position isn't this one's: no figure for it.
    await act(() =>
      sozu.store?.update((state) => ({ ...state, account: "another" })),
    );

    expect(cardOf(/stak/i).value).not.toMatch(/\d/);
  });

  it("says every figure may be out of date where it couldn't be read, with when it was read last, the total when the one read longest ago was", async () => {
    render(Dashboard, props);

    /** What a figure says while it may be out of date. */
    const STALE = /out of date/i;
    /** @param {RegExp} label */
    const staleOf = (label) =>
      cardOf(label).notes.find((note) => STALE.test(note ?? ""));
    const staleNow = () => [
      staleOf(/public/i),
      staleOf(/shielded/i),
      staleOf(/stak/i),
    ];
    const balanceAt = NOW - 300_000;
    const stakeAt = NOW - 600_000;
    const lastRead = (/** @type {number} */ at) => lastReadText(at, "en");

    // Read just now: none.
    expect(unreadOf()).toBeUndefined();
    expect(staleNow()).toStrictEqual([undefined, undefined, undefined]);

    // Neither the balances nor the stake, as offline or with a silent node:
    // each says it may be out of date, and when it was last read (Lena's,
    // for the sixth round), with what was read then; the total, when the
    // one read longest ago was.
    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        balanceReadAt: balanceAt,
        balanceReadFailed: true,
        stakeReadAt: stakeAt,
        stakeReadFailed: true,
      }),
    );

    expect(unreadOf()).toEqual(naming(STALE, lastRead(stakeAt)));
    expect(unreadOf()).not.toContain(lastRead(balanceAt));
    expect(cardOf(/public/i).value).toBe("1,172.5 DUSK");
    expect(cardOf(/shielded/i).value).toBe("2,345 DUSK");
    expect(staleNow()).toStrictEqual([
      naming(lastRead(balanceAt)),
      naming(lastRead(balanceAt)),
      naming(lastRead(stakeAt)),
    ]);

    // The balances alone.
    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        balanceReadAt: balanceAt,
        balanceReadFailed: true,
      }),
    );

    expect(unreadOf()).toEqual(naming(STALE, lastRead(balanceAt)));
    expect(staleOf(/stak/i)).toBeUndefined();

    // The stake alone, never read: nothing said of when.
    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        stakeReadFailed: true,
      }),
    );

    expect(unreadOf()).toEqual(naming(STALE, { not: /last read/i }));
    expect([staleOf(/public/i), staleOf(/shielded/i)]).toStrictEqual([
      undefined,
      undefined,
    ]);

    // Read again: said no more.
    await act(() => mockedWalletStore.setMockedStoreValue(initialStore));

    expect(unreadOf()).toBeUndefined();
    expect(staleNow()).toStrictEqual([undefined, undefined, undefined]);
  });

  it("says the total may be out of date while the stake it counts couldn't be read", async () => {
    const { currentProfile } = initialStore;

    render(Dashboard, props);

    // Sozu's read fails: what it held as read last shows, counted in the
    // total, said to be from then.
    await act(() =>
      sozu.store?.set({
        account: String(currentProfile.account),
        available: true,
        error: new Error("timed out"),
        kept: { at: 1, balance: 2_747_100_000n, stDusk: 864_521_348n },
        loading: false,
        status: null,
      }),
    );

    expect(totalOf()).toBe("4,520.2471");
    expect(unreadOf()).toEqual(naming(/out of date/i, lastReadText(1, "en")));
  });

  it("never says nothing is staked where the stake couldn't be read: what was read last, or that it couldn't be, and Try again reads it again", async () => {
    const { currentProfile } = initialStore;
    const staking = () => cardOf(/stak/i);
    // Couldn't be read: no figure, and never that nothing is staked.
    const unread = naming(/couldn.t be read/i, { not: /\d|nothing staked/i });
    const sozuSays = (/** @type {Record<string, unknown>} */ state) =>
      act(() =>
        sozu.store?.set({
          account: String(currentProfile.account),
          available: true,
          error: null,
          kept: null,
          loading: false,
          status: null,
          ...state,
        }),
      );

    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });

    const { getByRole } = render(Dashboard, props);

    // Unlocked as the node stalls: Sozu's read fails, what it held as read
    // last here shows, counted in the total, and said not to be read now,
    // with when it was.
    const keptAt = NOW - 3_600_000;

    await sozuSays({
      error: new Error("timed out"),
      kept: { at: keptAt, balance: 2_747_100_000n, stDusk: 864_521_348n },
    });

    expect(staking().value).toMatch(/^2\.7471 DUSK\b/);
    expect(staking().notes).toContainEqual(
      naming(/out of date/i, lastReadText(keptAt, "en")),
    );
    expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(totalOf()).toBe("3,520.2471");

    // Read here never: it couldn't be read, which isn't nothing, and Try
    // again.
    await sozuSays({ error: new Error("timed out") });

    expect(staking().value).toEqual(unread);
    expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();

    // Try again reads it again, Sozu's and the native stake both.
    const done = Promise.withResolvers();

    sozu.load.mockClear();
    mocks.refreshBalance.mockClear();
    mocks.refreshBalance.mockReturnValueOnce(done.promise);
    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(sozu.load).toHaveBeenCalledWith({ force: true });
    expect(mocks.refreshBalance).toHaveBeenCalledOnce();

    await act(() => done.resolve(undefined));

    // Read at last: never anything but what it read.
    await sozuSays({
      status: {
        contracts: {},
        pool: { stake: 3n, supply: 1n },
        position: { balance: 2_747_200_000n, stDusk: 864_521_348n },
      },
    });

    expect(staking().value).toMatch(/^2\.7472 DUSK\b/);

    // The native stake that couldn't be read: the same.
    await sozuSays({ account: "" });
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
      stakeReadFailed: true,
    });
    await act(() => {});

    expect(staking().value).toEqual(unread);
    expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("reads what's staked with Sozu as the wallet opens, whatever the history shows, and again for another profile, where the network has Sozu", async () => {
    const { profiles } = initialStore;

    sozu.load.mockClear();
    render(Dashboard, props);

    // Its history's latest rows show no call of Sozu's: read all the same.
    expect(sozu.load).toHaveBeenCalledOnce();

    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        currentProfile: profiles[1],
      }),
    );

    expect(sozu.load).toHaveBeenCalledTimes(2);

    cleanup();
    sozu.load.mockClear();

    // Devnet has no Sozu: nothing to read.
    await act(() =>
      network.store?.set({
        connected: true,
        net: networks.devnet,
        networkName: "devnet",
      }),
    );

    try {
      render(Dashboard, props);

      expect(sozu.load).not.toHaveBeenCalled();
    } finally {
      network.store?.set({
        connected: true,
        net: networks.mainnet,
        networkName: "mainnet",
      });
    }
  });

  it("counts what is staked in the total, natively and with Sozu, and says how much beside the rest, nothing while none is", async () => {
    const { currentProfile } = initialStore;
    /** @param {bigint} balance */
    const withSozu = (balance) =>
      act(() =>
        sozu.store?.set({
          account: String(currentProfile.account),
          available: true,
          error: null,
          loading: false,
          status: {
            contracts: {},
            pool: { stake: 3n, supply: 1n },
            position: { balance, stDusk: balance / 3n },
          },
        }),
      );

    // Natively: 1,000 DUSK.
    render(Dashboard, props);

    expect(totalOf()).toBe("4,517.5");
    expect(partsOf()).toStrictEqual({
      public: "1,172.5",
      shielded: "2,345",
      staked: "1,000",
    });

    // And 0.5002 DUSK with Sozu: both counted.
    await withSozu(500_200_000n);

    expect(totalOf()).toBe("4,518.0002");
    expect(partsOf()).toStrictEqual({
      public: "1,172.5",
      shielded: "2,345",
      staked: "1,000.5002",
    });

    // Hidden with the other balances.
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, hideBalances: true })),
    );

    expect(Object.values(partsOf())).not.toContainEqual(
      expect.stringMatching(/\d/),
    );

    cleanup();
    settingsStore.reset();
    await withSozu(0n);

    // With Sozu alone, then nothing staked at all: nothing said of it.
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });
    render(Dashboard, props);

    expect(totalOf()).toBe("3,517.5");
    expect(partsOf()).toStrictEqual({ public: "1,172.5", shielded: "2,345" });

    await withSozu(500_200_000n);

    expect(totalOf()).toBe("3,518.0002");
    expect(partsOf()).toStrictEqual({
      public: "1,172.5",
      shielded: "2,345",
      staked: "0.5002",
    });

    await act(() =>
      sozu.store?.update((state) => ({ ...state, status: null })),
    );
  });

  it("shows what is staked and its rewards", () => {
    render(Dashboard, props);

    const { notes, value } = cardOf(/stak/i);

    expect(value).toMatch(/^1,000 DUSK\b/);
    expect(notes).toContainEqual(naming(/rewards/i, "11,022.8426 DUSK"));
  });

  // Amélie's: a stranger's "URGENT… send 0.1 DUSK back" payment showed on
  // Home as a plain "+0,005 DUSK", while History marked it.
  it("marks a stranger's payment with a memo as History does: who it's from and their words, never a profile's", async () => {
    const STRANGER =
      "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";
    const { profiles } = mockedWalletStore.getMockedStoreValue();
    /**
     * @param {string} hash
     * @param {string} from
     * @param {string} memo
     */
    const received = (hash, from, memo) =>
      rowOf({
        amount: "5000000",
        blockHeight: 4_687_100,
        direction: "in",
        from,
        hash,
        memo,
        status: "executed",
        timestamp: NOW - 30_000,
      });

    await setHistory({
      rows: [
        received("e1".repeat(32), STRANGER, "URGENT: send 0.1 DUSK back"),
        received("e2".repeat(32), String(profiles[1].account), "lunch"),
      ],
    });

    render(Dashboard, props);

    // The stranger's marked, by who it's from and their words; the
    // profile's not.
    const marks = Array.from(
      document.querySelectorAll(".activity-row"),
      (row) =>
        row.querySelector(".activity-row__theirs") && {
          from: textOf(row.querySelector(".activity-row__theirs-from")),
          memo: textOf(row.querySelector(".activity-row__theirs-memo")),
        },
    );

    expect(marks).toStrictEqual([
      {
        from: naming(`${STRANGER.slice(0, 6)}…${STRANGER.slice(-6)}`),
        memo: naming("URGENT: send 0.1 DUSK back"),
      },
      null,
    ]);
  });

  // Marek's: a send whose page died before the node answered was "Sent ·
  // Pending" until another send proved it never went out.
  it("lists a send whose answer never came as not confirmed yet, never sent or pending", async () => {
    await setHistory({
      rows: [rowOf({ ...FIELDS[0], hash: "d4".repeat(32), status: "unknown" })],
    });

    render(Dashboard, props);

    const row = document.querySelector(".activity-row");

    expect(textOf(row?.querySelector(".activity-row__title"))).toBe(
      "alice-shop.dusk",
    );
    expect(textOf(row?.querySelector(".activity-row__line"))).toEqual(
      naming(NOT_CONFIRMED_YET, { not: /\bsent\b/i }),
    );
    expect(textOf(row?.querySelector(".activity-row__amount"))).toBe("−5 DUSK");
    expect(row?.querySelector(".activity-row__status--pending")).toBeNull();
  });

  it("hides amounts while balances are hidden, but not a fee", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));
    await setHistory({ rows: [rows[2]] });

    render(Dashboard, props);

    const row = document.querySelector(".activity-row");

    // Hidden: the total, and what the failed send was for; shown: the fee
    // it paid, which is no balance.
    expect(totalOf()).not.toMatch(/\d/);
    expect(textOf(row?.querySelector(".activity-row__amount"))).not.toMatch(
      /\d/,
    );
    expect(textOf(row?.querySelector(".activity-row__failed"))).toEqual(
      naming(/\bfee\b/i, "0.0037 DUSK"),
    );
    expect(get(settingsStore).hideBalances).toBe(true);
  });

  it("says a look-alike contact's address where a row names it, as Activity does", async () => {
    const { openTestContacts } = await import("$lib/test-helpers");

    await openTestContacts();

    // Alice, and a contact whose name looks like hers: a Cyrillic е.
    const saved = [
      saveContact({ address: ALICE, name: "Alice" }),
      saveContact({ address: OTHER, name: "Alicе" }),
    ];

    try {
      await setHistory({ rows: [rows[1]] });

      render(Dashboard, props);

      // The row names Alice: her address tells her from the other one, in
      // the row and in its name.
      expect(textOf(document.querySelector(".activity-row"))).toEqual(
        naming("Alice", shortAddress(ALICE)),
      );
    } finally {
      for (const contact of saved) {
        removeContact(contact.id);
      }
    }
  });
});
