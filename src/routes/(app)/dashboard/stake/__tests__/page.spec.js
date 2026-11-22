import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { getGasSettings } from "$lib/contracts";
import { formatFee } from "$lib/dusk/currency";
import { gasPriceStore, settingsStore, walletStore } from "$lib/stores";
import nodeNetworkStore from "$lib/stores/networkStore";

import { afterConfirmDelay } from "$lib/dusk/test-helpers";

import Staking from "../+page.svelte";
import { networks } from "@dusk-network/networks";

const page = vi.hoisted(() => ({
  url: new URL("http://localhost/some-base-path/dashboard/stake"),
}));

vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
    // No navigation under way: a form left is left by a link.
    navigating: readable(null),
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        readable({ url: page.url }).subscribe(run),
    },
  };
});

const network = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  store: null,
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  network.store = writable({ connected: true, networkName: "testnet" });

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      getCurrentBlockHeight: () => Promise.resolve(4_700_000n),
      subscribe: network.store.subscribe,
    },
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

const history = vi.hoisted(() => ({
  refresh: vi.fn(() => Promise.resolve()),
  /** @type {import("svelte/store").Writable<any> | null} */
  state: null,
}));

// A transaction's block never final, unless a test says otherwise.
const { followTransaction } = vi.hoisted(() => ({
  followTransaction: vi.fn(() => new Promise(() => {})),
}));

vi.mock("$lib/transactions", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  followTransaction,
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
    currentActivity: () => ({ refresh: history.refresh }),
    // All of the history: here, the page shown.
    wholeActivity: derived(history.state, ({ rows }) => ({
      failed: false,
      reading: false,
      rows,
      whole: true,
    })),
  };
});

// What native staking pays a year: not read here.
vi.mock("$lib/staking/rewardRate", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  readNativeRewards: async () => ({ days: null, native: null, rate: null }),
}));

const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";

/** Sozu as read on testnet: about 3.0751 DUSK a stDUSK, and its fees. */
const SOZU_STATUS = {
  contracts: { hub: "bae8".padEnd(64, "0"), pool: POOL, stDusk: null },
  fees: {
    deposit: { denominator: 10_000n, numerator: 25n },
    reward: { denominator: 100n, numerator: 10n },
  },
  // Deposits open, and the pool not synchronizing.
  flags: { maintenance: false, synchronization: false },
  pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
  position: { balance: 0n, stDusk: 0n },
};

const sozu = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<() => Promise<any>>} */
  check: vi.fn(async () => null),
  load: vi.fn(() => Promise.resolve()),
  readAfter: vi.fn(() => Promise.resolve()),
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
    // How Sozu's stDUSK grew lately: not read here.
    readSozuGrowth: vi.fn(async () => null),
    sozuStore: {
      check: sozu.check,
      load: sozu.load,
      readAfter: sozu.readAfter,
      reset: () => {},
      subscribe: sozu.store.subscribe,
    },
  };
});

const initialStore = mockedWalletStore.getMockedStoreValue();

/** The wallet with `publicDusk` public DUSK, and no stake or rewards. */
const withoutStake = (publicDusk = 172n) =>
  mockedWalletStore.setMockedStoreValue({
    ...initialStore,
    balance: {
      ...initialStore.balance,
      unshielded: { nonce: 1n, value: publicDusk * 1_000_000_000n },
    },
    stakeInfo: { amount: null, faults: 0, hardFaults: 0, reward: 0n },
  });

/** @param {string} search */
const open = (search) => {
  page.url = new URL(
    `http://localhost/some-base-path/dashboard/stake${search}`,
  );
};

/** @param {Element | null} element */
const textOf = (element) => element?.textContent?.replace(/\s+/g, " ").trim();

/**
 * Matches a name or a text that shows `amount` DUSK, whatever its words.
 *
 * @param {string} amount As the page writes it, as "1,000"
 * @returns {(text: string) => boolean}
 */
const showsDusk = (amount) => (text) => ` ${text}`.includes(` ${amount} DUSK`);

/**
 * Matches `value` whole: not inside a longer figure, nor signed, so "1 DUSK"
 * matches neither "11 DUSK", "0.1 DUSK" nor a signed "1 DUSK".
 *
 * @param {string} value As the page writes it, as "1,000 DUSK"
 */
const wholeFigure = (value) =>
  new RegExp(`(?<![^ ])${value.replaceAll(".", "[.]")}(?![.,]?[0-9])`);

/**
 * What the amount field says there is to stake, or to unstake.
 *
 * @param {HTMLElement} field
 */
const availableOf = (field) =>
  textOf(
    document.getElementById(
      String(field.getAttribute("aria-describedby")).split(" ")[0],
    ),
  ) ?? "";

describe("Staking", () => {
  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    settingsStore.reset();
    mockedWalletStore.setMockedStoreValue(initialStore);
    open("");
    sozu.load.mockClear();
    sozu.readAfter.mockClear();
    sozu.check.mockReset();
    vi.restoreAllMocks();
    sozu.store?.set({
      account: "",
      available: true,
      error: null,
      loading: false,
      status: null,
    });
    await act(() => history.state?.update((s) => ({ ...s, rows: [] })));
  });

  afterAll(() => {
    vi.doUnmock("$app/stores");
    vi.doUnmock("$lib/stores");
    vi.doUnmock("$lib/activity");
    vi.doUnmock("$lib/sozu");
  });

  it("turns its buttons off while a staking transaction is pending, and on once it settles", async () => {
    const account = String(initialStore.currentProfile.account);

    await act(() =>
      sozu.store?.update((s) => ({
        ...s,
        status: {
          ...SOZU_STATUS,
          position: { balance: 1_500_000_000_000n, stDusk: 487_800_000_000n },
        },
      })),
    );
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      pendingStakes: [{ account, hash: "ab".repeat(32) }],
    });

    const { getByRole } = render(Staking);
    const links = [
      "Unstake from Sozu",
      "Add to native stake",
      "Add to Sozu stake",
    ];

    expect(getByRole("button", { name: "Unstake native" })).toBeDisabled();
    expect(getByRole("button", { name: "Claim rewards" })).toBeDisabled();

    for (const name of links) {
      expect(getByRole("link", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      // One that kept focus as it went pending still takes Enter: it goes nowhere.
      expect(
        getByRole("link", { name }).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        ),
      ).toBe(false);
    }

    await act(() =>
      mockedWalletStore.setMockedStoreValue({
        ...initialStore,
        pendingStakes: [],
      }),
    );

    expect(getByRole("button", { name: "Unstake native" })).toBeEnabled();
    expect(getByRole("button", { name: "Claim rewards" })).toBeEnabled();

    for (const name of links) {
      expect(getByRole("link", { name })).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    }
  });

  it("turns its buttons on again once it gave up reading the stake after a staking transaction", () => {
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      pendingStakes: [
        {
          account: String(initialStore.currentProfile.account),
          hash: "ab".repeat(32),
          stale: true,
        },
      ],
    });

    const { getByRole } = render(Staking);

    expect(getByRole("button", { name: "Unstake" })).toBeEnabled();
    expect(getByRole("button", { name: "Claim rewards" })).toBeEnabled();
    expect(getByRole("link", { name: "Add to native stake" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("leaves its buttons on while another account's staking transaction is pending", () => {
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      pendingStakes: [{ account: "another-account", hash: "ab".repeat(32) }],
    });

    const { getByRole } = render(Staking);

    expect(getByRole("button", { name: "Unstake" })).toBeEnabled();
    expect(getByRole("button", { name: "Claim rewards" })).toBeEnabled();
    expect(getByRole("link", { name: "Add to native stake" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("gives what's available to stake, from the public balance, and what a stDUSK is worth now, as Sozu's pool says", async () => {
    const { container } = render(Staking);
    const available = Array.from(
      container.querySelectorAll(".staking__figures > div"),
    ).find((row) => textOf(row.querySelector("dt")) === "Available to stake");

    // Its own tile: the amount, and where it comes from.
    expect(textOf(available?.querySelector(".staking__amount") ?? null)).toBe(
      "1,172.5 DUSK",
    );
    expect(textOf(available?.querySelector(".staking__sub") ?? null)).toBe(
      "From your public balance",
    );

    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));

    // In the comparison's Rewards row, Sozu's side: a stDUSK's worth now,
    // live from the pool, and that it can fall.
    const rewards = Array.from(
      container.querySelectorAll("table.compare tbody tr"),
    ).find((row) => textOf(row.querySelector("th")) === "Rewards");

    expect(textOf(rewards?.querySelectorAll("td")[1] ?? null)).toMatch(
      /(?:^|\s)You get stDUSK\. Each is worth 3\.0751 DUSK now\. It usually rises with rewards, but can fall with a penalty\.$/,
    );
  });

  it("hides the amounts while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(Staking);
    const figures = Array.from(
      container.querySelectorAll(".staking__figure"),
      textOf,
    );

    // 1,000 staked, 11,022.8426 in rewards and 1,172.5 available: none shows.
    expect(figures).toHaveLength(3);
    for (const figure of figures) {
      expect(figure).not.toMatch(/[0-9]/);
    }
  });

  describe("native staking", () => {
    it("says the minimum under the amount, with a way to use it", async () => {
      open("?flow=native");
      withoutStake(1_483n);

      const { getByLabelText, getByRole, queryByRole } = render(Staking);
      const amount = getByLabelText("Amount");

      await fireEvent.input(amount, { target: { value: "100" } });

      expect(getByRole("alert")).toHaveTextContent(/minimum/i);
      expect(getByRole("alert")).toHaveTextContent(wholeFigure("1,000 DUSK"));
      expect(getByRole("button", { name: "Review" })).toBeDisabled();

      await fireEvent.click(getByRole("button", { name: /1,000/ }));

      expect(amount).toHaveValue("1000");
      expect(queryByRole("alert")).toBeNull();

      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(
        getByRole("button", { name: showsDusk("1,000") }),
      ).toBeInTheDocument();
    });

    it("says how much more an amount needs, with this fee and the fee to unstake later", async () => {
      open("?flow=native");
      withoutStake(1_483n);

      const { getByLabelText, getByRole } = render(Staking);

      await fireEvent.input(getByLabelText("Amount"), {
        target: { value: "1483" },
      });

      expect(getByRole("alert")).toHaveTextContent(wholeFigure("0.1 DUSK"));
    });

    it("keeps the fee to unstake, at this network's gas, with Max", async () => {
      open("?flow=native");
      withoutStake(1_483n);

      const { getByLabelText, getByRole } = render(Staking);

      await fireEvent.click(getByRole("button", { name: "Max" }));

      expect(getByLabelText("Amount")).toHaveValue("1482.9");
    });
  });

  describe("gas price", () => {
    /** Sozu's activation after a stake, waiting alone at 2. */
    const SOZU_ACTIVATION = [{ gasLimit: 6_000_000, gasPrice: "2" }];

    /** More than the next block takes, each at 900. */
    const BUSY = Array.from({ length: 1_000 }, () => ({
      gasLimit: 2_500_000,
      gasPrice: "900",
    }));

    /**
     * What waits in the node's mempool, as its GraphQL lists it, read.
     *
     * @param {Array<{ gasLimit: number, gasPrice: string }>} mempoolTxs
     */
    const nodeHolds = async (mempoolTxs) => {
      vi.spyOn(nodeNetworkStore, "connect").mockResolvedValue(
        /** @type {any} */ ({ query: async () => ({ mempoolTxs }) }),
      );
      await gasPriceStore.refresh();
    };

    afterEach(async () => {
      // The lowest again, as the other tests start from.
      await nodeHolds([]);
    });

    it.each(
      /** @type {const} */ ([
        ["a native stake", "?flow=native", "stake", "Amount", "1000"],
        [
          "a stake with Sozu",
          "?flow=liquid&action=stake",
          "liquid-stake",
          "Amount",
          "100",
        ],
        [
          "an unstake from Sozu",
          "?flow=liquid&action=unstake",
          "liquid-unstake",
          "Amount",
          "100",
        ],
        ["a native unstake", "?flow=unstake", "unstake", "Amount", "100"],
      ]),
    )(
      "prices %s's Review from what waits in the mempool: the lowest with Sozu's activation alone at 2, five times it with a busy block",
      async (_, search, operation, label, value) => {
        for (const [mempool, price] of /** @type {const} */ ([
          [SOZU_ACTIVATION, 1n],
          [BUSY, 5n],
        ])) {
          await nodeHolds([...mempool]);
          open(search);

          if (operation !== "unstake") {
            withoutStake(1_483n);
          }

          await act(() =>
            sozu.store?.update((s) => ({
              ...s,
              status: {
                ...SOZU_STATUS,
                position: {
                  balance: 200_000_000_000n,
                  stDusk: 200_000_000_000n,
                },
              },
            })),
          );
          sozu.check.mockResolvedValue(SOZU_STATUS);

          const { container, getByRole } = render(Staking);

          await fireEvent.input(getByRole("textbox", { name: label }), {
            target: { value },
          });
          await fireEvent.click(
            getByRole("button", {
              name: "Review",
            }),
          );

          const { gasLimit } = getGasSettings(
            operation,
            { customGasLimit: null, customGasPrice: null },
            price,
          );

          // On its Review.
          if (operation === "unstake") {
            expect(container.querySelector(".review-amount")).not.toBeNull();
          } else {
            expect(
              container.querySelector(".stake-flow--review"),
            ).not.toBeNull();
          }

          const fee = formatFee(gasLimit * price, "en", { max: true });

          if (operation === "unstake") {
            expect(
              Array.from(
                container.querySelectorAll(".review-amount dd"),
                textOf,
              ),
            ).toContain(`${fee} DUSK`);
          } else {
            expect(
              textOf(container.querySelector(".gas-fee__amount-value")),
            ).toBe(fee);
          }

          cleanup();
        }
      },
    );
  });

  it("says what's on its way to Sozu after a reload, and once its block is final, reads the history, the balances with Sozu and the form's position again", async () => {
    /** @type {(final: unknown) => void} */
    let final = () => {};

    followTransaction.mockReturnValueOnce(
      new Promise((resolve) => {
        final = resolve;
      }),
    );

    const refresh = vi
      .spyOn(walletStore, "refreshBalance")
      .mockResolvedValue(undefined);
    const whole = vi.fn(async () => ({ rows: [], shieldedWaiting: false }));

    vi.spyOn(walletStore, "startHistory").mockReturnValue(
      /** @type {any} */ ({ sozuFacts: async () => new Map(), whole }),
    );

    open("?flow=liquid");
    withoutStake();
    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));
    await act(() =>
      history.state?.update((state) => ({
        ...state,
        rows: [
          rowOf(
            {
              amount: "100000000",
              contractId: POOL,
              fnName: "sozu_stake",
              hash: "f1".repeat(32),
              kind: "contract_call",
              privacy: "public",
              source: "local",
              status: "submitted",
              submittedAt: Date.now(),
              to: POOL,
            },
            // Testnet's pool.
            { network: networks.testnet },
          ),
        ],
      })),
    );

    const { container, getByLabelText } = render(Staking);
    const underWay = container.querySelector(".liquid-stake__under-way");

    expect(underWay).toHaveTextContent(wholeFigure("0.1 DUSK"));
    expect(underWay).toHaveTextContent(/ stake /);
    // 172 DUSK less the 0.1 on its way.
    expect(availableOf(getByLabelText("Amount"))).toMatch(
      wholeFigure("171.9 DUSK"),
    );
    expect(followTransaction).toHaveBeenCalledExactlyOnceWith("f1".repeat(32));

    // The form read its position as it opened.
    await vi.waitFor(() => expect(whole).toHaveBeenCalledOnce());
    sozu.load.mockClear();
    whole.mockClear();
    final({ blockHeight: 1n, error: null, fee: 1n, timestamp: null });

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(history.refresh).toHaveBeenCalled();
    // Sozu comes with the balances, shown together: never read alone, for
    // Home to count a stake once, with the public balance it left.
    expect(sozu.load).not.toHaveBeenCalled();
    // And again, from the history once it's read again.
    await vi.waitFor(() => expect(whole).toHaveBeenCalledOnce());
  });

  it("stakes with Sozu from liquid staking", async () => {
    open("?flow=liquid");
    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));

    const { container, getByLabelText, getByRole } = render(Staking);

    expect(sozu.load).toHaveBeenCalledWith();

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "100" },
    });

    // For what's left once testnet's 0.25% deposit fee is off it.
    const estimate = container.querySelector(".liquid-stake__estimate");

    expect(estimate).toHaveTextContent(wholeFigure("32.4378 stDUSK"));
    expect(estimate).toHaveTextContent(wholeFigure("99.75 DUSK"));
    expect(getByRole("button", { name: "Review" })).toBeEnabled();
    // A stake's own gas: up to 5,000,000 at the node's price.
    expect(
      container.querySelector(".stake-flow__rows--total dd"),
    ).toHaveTextContent(wholeFigure("100.005 DUSK"));

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));

    // An unstake's: up to 10,000,000, as it can touch more provisioners,
    // paid from what comes back.
    expect(textOf(container.querySelector(".gas-fee__amount-value"))).toBe(
      "0.01",
    );
  });

  it.each([
    ["stake", "stakeWithSozu", "Amount"],
    ["unstake", "unstakeFromSozu", "Amount"],
  ])(
    "reads Sozu again after a %s's transaction",
    async (action, service, label) => {
      // The button takes a click half a second after it shows: on this clock.
      vi.useFakeTimers({ toFake: ["performance"] });
      open(`?flow=liquid&action=${action}`);
      await act(() =>
        sozu.store?.update((s) => ({
          ...s,
          status: {
            ...SOZU_STATUS,
            position: { balance: 200_000_000_000n, stDusk: 200_000_000_000n },
          },
        })),
      );
      sozu.check.mockResolvedValue(SOZU_STATUS);
      vi.spyOn(
        walletStore,
        /** @type {"stakeWithSozu" | "unstakeFromSozu"} */ (service),
      ).mockResolvedValue(/** @type {any} */ ({ hash: "a-hash" }));

      const { getByLabelText, getByRole } = render(Staking);

      await fireEvent.input(getByLabelText(label), {
        target: { value: "100" },
      });
      await fireEvent.click(getByRole("button", { name: "Review" }));
      await afterConfirmDelay();
      await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

      await vi.waitFor(() =>
        expect(sozu.readAfter).toHaveBeenCalledWith("a-hash"),
      );
    },
  );

  it("reads Sozu again before a stake goes, and stakes on the terms it read", async () => {
    // Stake takes a click half a second after it shows: on this clock.
    vi.useFakeTimers({ toFake: ["performance"] });
    open("?flow=liquid");
    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));
    sozu.check.mockResolvedValue(SOZU_STATUS);

    const stakeWithSozu = vi
      .spyOn(walletStore, "stakeWithSozu")
      .mockReturnValue(new Promise(() => {}));
    const { getByLabelText, getByRole } = render(Staking);

    await fireEvent.input(getByLabelText("Amount"), {
      target: { value: "100" },
    });
    await fireEvent.click(getByRole("button", { name: "Review" }));
    await afterConfirmDelay();
    await fireEvent.click(getByRole("button", { name: showsDusk("100") }));

    await vi.waitFor(() => expect(stakeWithSozu).toHaveBeenCalledOnce());
    expect(sozu.check).toHaveBeenCalledOnce();
    expect(stakeWithSozu.mock.calls[0].slice(0, 2)).toStrictEqual([
      POOL,
      100_000_000_000n,
    ]);
  });
});
