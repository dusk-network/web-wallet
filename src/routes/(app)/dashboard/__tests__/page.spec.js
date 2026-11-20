import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import {
  NOT_CONFIRMED_YET,
  lastReadText,
  timeLabel,
} from "$lib/activity/present";
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
 * A sentence that names each of `values`, in any order, whatever its words.
 *
 * @param {...string} values
 */
const naming = (...values) =>
  expect.stringMatching(
    new RegExp(
      values
        .map((value) => `(?=.*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
        .join(""),
    ),
  );

/**
 * The figures an element shows, in order.
 *
 * @param {Element | null | undefined} element
 */
const figuresOf = (element) => element?.textContent?.match(/\d[\d,.]*/g) ?? [];

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
      says: said.textContent?.replace(/\s+/g, " ").trim(),
    };
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

  it("says a send waits to go out while the network doesn't answer, with Cancel, wherever it was sent from, until it goes out, each with its memo and time to tell them apart", async () => {
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
        {
          offers: ["Cancel"],
          says: naming("0.01 DUSK", "Profile 2", "ward round 1", one),
        },
        {
          offers: ["Cancel"],
          says: naming("0.01 DUSK", "Profile 2", "ward round 2", two),
        },
      ]);

      const [, { says: waiting }] = waitingBanners();

      // Called off from here: nothing goes out, and it's said.
      await fireEvent.click(
        /** @type {HTMLElement} */ (
          document.querySelector(".home__waiting button")
        ),
      );

      expect(get(first)).toBe("cancelled");
      expect(waitingBanners()).toStrictEqual([
        { offers: ["Cancel"], says: waiting },
      ]);
      expect(get(toastList).map(({ message }) => message)).toContainEqual(
        naming("0.01 DUSK", "Profile 2"),
      );

      // The other goes out once the network answers: sent, said so, with
      // nothing to call off, until the node took it.
      await act(() => setNetworkReach("answering"));
      await act(() => second.handOver());

      expect(waitingBanners()).toStrictEqual([
        {
          offers: [],
          says: naming("0.01 DUSK", "Profile 2", "ward round 2", two),
        },
      ]);
      expect(waitingBanners()[0].says).not.toBe(waiting);

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

      const [sending] = waitingBanners();

      expect(sending).toStrictEqual({
        offers: ["Cancel"],
        says: naming("0.01 DUSK", "Profile 2", at),
      });

      // The node can't be reached as it's sent: it waits for the network,
      // said so, and can still be called off.
      gate
        .untilHandedOver(
          () => Promise.reject(new TypeError("Failed to fetch")),
          () => new Promise(() => {}),
        )
        .catch(() => {});
      await vi.waitFor(() =>
        expect(waitingBanners()[0].says).not.toBe(sending.says),
      );
      expect(waitingBanners()).toStrictEqual([
        { offers: ["Cancel"], says: naming("0.01 DUSK", "Profile 2", at) },
      ]);

      // Handed over: sent, said so, with nothing to call off, until the
      // node took it, and then no longer said here.
      await act(() => gate.handOver());

      expect(waitingBanners()).toStrictEqual([
        { offers: [], says: sending.says },
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
  it("says a waiting send is being sent from the moment the node is asked to check it, though the pill finds the network silent, with Cancel until it's handed over", async () => {
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

      const [waiting] = waitingBanners();

      expect(waiting).toStrictEqual({
        offers: ["Cancel"],
        says: naming("0.01 DUSK", "your Profile 2", at),
      });

      // The node is asked to check it: it goes out, said so, its answer
      // slow, and can still be called off.
      await act(() => gate.checking());

      const [sending] = waitingBanners();

      expect(sending).toStrictEqual({
        offers: ["Cancel"],
        says: naming("0.01 DUSK", "your Profile 2", at),
      });
      expect(sending.says).not.toBe(waiting.says);

      // Handed over: sent, with nothing to call off, until the node took
      // it, and then no longer said here, as Activity has it.
      await act(() => gate.handOver());

      expect(waitingBanners()).toStrictEqual([
        { offers: [], says: sending.says },
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
        {
          offers: ["Send it too", "Don't send"],
          says: naming("0.01 DUSK", "your Profile 2", "night shift 6", at),
        },
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
          message: naming("0.01 DUSK", "your Profile 2"),
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
    const { sayMeanwhile } = await import("$lib/transactions/sentMeanwhile");
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
    const banner = () =>
      document
        .querySelector(".home__waiting")
        ?.textContent?.replace(/\s+/g, " ")
        .trim();

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
    // That it looks like this same payment, as the wallet says it.
    const { same } = sayMeanwhile(
      [
        {
          at: sentAt,
          hash: "9a".repeat(32),
          lux: 10_000_000n,
          memo: "night shift 9",
          nonce: 1234n,
          to: ALICE,
        },
      ],
      { address: ALICE, lux: 10_000_000n, memo: "night shift 9" },
      { hidden: false, locale: "en", nameOf: shortenAddress },
    );

    expect(same).not.toBe("");

    gate.ask({ account, from: 1233n, to: 1234n }).catch(() => {});

    try {
      // What was sent, to whom and when, the same payment, and the send
      // held.
      await vi.waitFor(() =>
        expect(banner()).toEqual(
          naming(
            "0.01 DUSK",
            shortenAddress(ALICE),
            timeLabel(sentAt, "en"),
            same,
            "Alice",
            "night shift 9",
            at,
          ),
        ),
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
    const banner = () =>
      document
        .querySelector(".home__waiting")
        ?.textContent?.replace(/\s+/g, " ")
        .trim();
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

      expect(banner()).toContain(CHECKING_TEXT);
      expect(buttons()).toStrictEqual([
        ["Send it too", true],
        ["Don't send", true],
      ]);

      // Not found within a moment: what's known, and the answers on.
      answers.resolve();
      await act(() => vi.advanceTimersByTimeAsync(CHECKING_FOR_MS));

      expect(banner()).not.toContain(CHECKING_TEXT);
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

      const banner = () =>
        document
          .querySelector(".home__waiting")
          ?.textContent?.replace(/\s+/g, " ")
          .trim();

      expect(banner()).toContain("0.01 DUSK");

      await act(() =>
        settingsStore.update((store) => ({ ...store, hideBalances: true })),
      );

      expect(banner()).toContain("Profile 2");
      expect(banner()).not.toContain("0.01");

      await fireEvent.click(
        /** @type {HTMLElement} */ (
          document.querySelector(".home__waiting button")
        ),
      );

      // Said as it's called off, its amount hidden too.
      const messages = get(toastList).map(({ message }) => message);

      expect(get(gate)).toBe("cancelled");
      expect(messages).toContainEqual(expect.stringContaining("Profile 2"));
      expect(
        messages.filter((message) => message.includes("0.01")),
      ).toStrictEqual([]);
    } finally {
      gate.cancel();
      setNetworkReach("answering");
    }
  });

  it("shows the total balance, everything held, its parts, and its value in money", async () => {
    const { container } = render(Dashboard, props);

    // 1,172.5 public, 2,345 shielded and 1,000 staked.
    expect(container.querySelector(".home-balance__amount")).toHaveTextContent(
      "4,517.5",
    );
    expect(
      figuresOf(container.querySelector(".home-balance__legend")),
    ).toStrictEqual(["1,172.5", "2,345", "1,000"]);

    await vi.waitFor(() =>
      expect(container.querySelector(".home-balance__fiat")).toHaveTextContent(
        "$2,258.75",
      ),
    );
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
    const { container } = render(Dashboard, props);

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

    expect(container.querySelectorAll(".explainer-card")[2]).toHaveTextContent(
      "1,500 DUSK",
    );

    // Another profile's position isn't this one's.
    await act(() =>
      sozu.store?.update((state) => ({ ...state, account: "another" })),
    );

    expect(
      container.querySelectorAll(".explainer-card")[2],
    ).not.toHaveTextContent("1,500");
  });

  it("says every figure may be out of date where it couldn't be read, with when it was read last, the total when the one read longest ago was", async () => {
    const { container } = render(Dashboard, props);
    const textOf = (/** @type {Element | null | undefined} */ element) =>
      element?.textContent?.replace(/\s+/g, " ").trim();
    const total = () => textOf(container.querySelector(".home-balance"));
    const card = (/** @type {number} */ n) =>
      textOf(container.querySelectorAll(".explainer-card")[n]);
    // Each as it says it, read just now, its value in money too.
    const shown = () => [total(), card(0), card(1), card(2)];

    await act(() => props.data.currentPrice);

    const fresh = shown();

    // Neither the balances nor the stake, as offline or with a silent node:
    // each says when it was last read (Lena's, for the sixth round), the
    // total when the one read longest ago was.
    const balanceAt = NOW - 300_000;
    const stakeAt = NOW - 600_000;
    const lastRead = (/** @type {number} */ at) => lastReadText(at, "en");

    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        balanceReadAt: balanceAt,
        balanceReadFailed: true,
        stakeReadAt: stakeAt,
        stakeReadFailed: true,
      }),
    );

    expect(total()).toContain(lastRead(stakeAt));
    expect(total()).not.toContain(lastRead(balanceAt));
    expect(card(0)).toEqual(naming("1,172.5 DUSK", lastRead(balanceAt)));
    expect(card(1)).toEqual(naming("2,345 DUSK", lastRead(balanceAt)));
    expect(card(2)).toContain(lastRead(stakeAt));

    // The balances alone.
    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        balanceReadAt: balanceAt,
        balanceReadFailed: true,
      }),
    );

    expect(total()).toContain(lastRead(balanceAt));
    expect(card(2)).toBe(fresh[3]);

    // The stake alone, never read.
    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        stakeReadFailed: true,
      }),
    );

    expect(total()).not.toBe(fresh[0]);
    expect([card(0), card(1)]).toStrictEqual([fresh[1], fresh[2]]);

    // Read again: said no more.
    await act(() => mockedWalletStore.setMockedStoreValue(initialStore));

    expect(shown()).toStrictEqual(fresh);
  });

  it("says the total may be out of date while the stake it counts couldn't be read", async () => {
    const { currentProfile } = initialStore;
    const { container } = render(Dashboard, props);

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

    expect(container.querySelector(".home-balance__amount")).toHaveTextContent(
      "4,520.2471",
    );
    expect(container.querySelector(".home-balance")).toHaveTextContent(
      lastReadText(1, "en"),
    );
  });

  it("never says nothing is staked where the stake couldn't be read: what was read last, or that it couldn't be, and Try again reads it again", async () => {
    const { currentProfile } = initialStore;
    const card = () =>
      container
        .querySelectorAll(".explainer-card")[2]
        ?.textContent?.replace(/\s+/g, " ")
        .trim();
    const total = () =>
      container.querySelector(".home-balance__amount")?.textContent?.trim();
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

    const { container, getByRole } = render(Dashboard, props);

    // Unlocked as the node stalls: Sozu's read fails, what it held as read
    // last here shows, counted in the total, and said not to be read now,
    // with when it was.
    const keptAt = NOW - 3_600_000;

    await sozuSays({
      error: new Error("timed out"),
      kept: { at: keptAt, balance: 2_747_100_000n, stDusk: 864_521_348n },
    });

    expect(card()).toEqual(naming("2.7471 DUSK", lastReadText(keptAt, "en")));
    expect(getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(total()).toBe("3,520.2471");

    // Read here never: it couldn't be read, which isn't nothing: no figure,
    // and Try again.
    await sozuSays({ error: new Error("timed out") });

    expect(card()).not.toMatch(/\d/);
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

    expect(card()).toContain("2.7472 DUSK");
    expect(card()).not.toContain("2.7471");

    // The native stake that couldn't be read: the same.
    await sozuSays({ account: "" });
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
      stakeReadFailed: true,
    });
    await act(() => {});

    expect(card()).not.toMatch(/\d/);
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
    const total = () =>
      document.querySelector(".home-balance__amount")?.textContent?.trim();
    const parts = () =>
      figuresOf(document.querySelector(".home-balance__legend"));
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

    expect(total()).toBe("4,517.5");
    expect(parts()).toStrictEqual(["1,172.5", "2,345", "1,000"]);

    // And 0.5002 DUSK with Sozu: both counted.
    await withSozu(500_200_000n);

    expect(total()).toBe("4,518.0002");
    expect(parts()).toStrictEqual(["1,172.5", "2,345", "1,000.5002"]);

    // Hidden with the other balances.
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, hideBalances: true })),
    );

    expect(parts()).toStrictEqual([]);

    cleanup();
    settingsStore.reset();
    await withSozu(0n);

    // With Sozu alone, then nothing staked at all: nothing said of it.
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });
    render(Dashboard, props);

    expect(total()).toBe("3,517.5");
    expect(parts()).toStrictEqual(["1,172.5", "2,345"]);

    await withSozu(500_200_000n);

    expect(total()).toBe("3,518.0002");
    expect(parts()).toStrictEqual(["1,172.5", "2,345", "0.5002"]);

    await act(() =>
      sozu.store?.update((state) => ({ ...state, status: null })),
    );
  });

  it("shows what is staked and its rewards", () => {
    const { container } = render(Dashboard, props);

    expect(
      figuresOf(container.querySelectorAll(".explainer-card")[2]),
    ).toStrictEqual(["1,000", "11,022.8426"]);
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

    const { container } = render(Dashboard, props);
    const marks = () =>
      Array.from(container.querySelectorAll(".activity-row"), (row) =>
        row
          .querySelector(".activity-row__theirs")
          ?.textContent?.replace(/\s+/g, " ")
          .trim(),
      );

    expect(marks()).toStrictEqual([
      naming(
        `${STRANGER.slice(0, 6)}…${STRANGER.slice(-6)}`,
        "URGENT: send 0.1 DUSK back",
      ),
      undefined,
    ]);
  });

  // Marek's: a send whose page died before the node answered was "Sent ·
  // Pending" until another send proved it never went out.
  it("lists a send whose answer never came as not confirmed yet, never sent or pending", async () => {
    await setHistory({
      rows: [rowOf({ ...FIELDS[0], hash: "d4".repeat(32), status: "unknown" })],
    });

    const { container } = render(Dashboard, props);
    const [item] = Array.from(
      container.querySelectorAll(".activity-row"),
      (row) => row.textContent?.replace(/\s+/g, " ").trim(),
    );

    expect(item).toEqual(
      naming("alice-shop.dusk", NOT_CONFIRMED_YET, "−5 DUSK"),
    );
    expect(item).not.toMatch(/Sent|Pending/);
  });

  it("hides amounts while balances are hidden, but not a fee", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));
    await setHistory({ rows: [rows[2]] });

    const { container } = render(Dashboard, props);

    expect(
      container.querySelector(".home-balance__amount"),
    ).not.toHaveTextContent(/\d/);
    expect(container.querySelector(".activity-row")).toHaveTextContent(
      "0.0037 DUSK",
    );
    expect(container.querySelector(".activity-row")).not.toHaveTextContent(
      /\b200\b/,
    );
    expect(get(settingsStore).hideBalances).toBe(true);
  });
});
