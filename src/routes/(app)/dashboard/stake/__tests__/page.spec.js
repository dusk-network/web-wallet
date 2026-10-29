import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { settingsStore, walletStore } from "$lib/stores";

import Staking from "../+page.svelte";

const page = vi.hoisted(() => ({
  url: new URL("http://localhost/some-base-path/dashboard/stake"),
}));

vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
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
  /** @type {import("svelte/store").Writable<any> | null} */
  state: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  /** @type {typeof import("$lib/activity")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  history.state = writable({
    complete: true,
    error: null,
    hasMore: false,
    loaded: true,
    rows: [],
    syncing: false,
  });

  return { ...original, activityState: history.state };
});

/** About what native staking pays a year, as the node's provisioners say. */
const rates = vi.hoisted(() => ({
  native: /** @type {number | null} */ (null),
}));

vi.mock("$lib/staking/rewardRate", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  readNativeRewardRate: async () => rates.native,
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
      check: sozu.check,
      load: sozu.load,
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
    `http://localhost/some-base-path/dashboard/stake${search}`
  );
};

/** @param {Element | null} element */
const textOf = (element) => element?.textContent?.replace(/\s+/g, " ").trim();

describe("Staking", () => {
  afterEach(async () => {
    cleanup();
    settingsStore.reset();
    mockedWalletStore.setMockedStoreValue(initialStore);
    open("");
    sozu.load.mockClear();
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

  it("shows what is staked, its rewards and what can be staked, and reads Sozu", () => {
    const { container, getByRole } = render(Staking);
    const figures = Array.from(
      container.querySelectorAll(".staking__figures > div"),
      textOf
    );

    expect(figures).toStrictEqual([
      "Staked 1,000 DUSK",
      "Rewards 11,022.8426 DUSK",
      "Available to stake 1,172.5 DUSK From your public balance",
    ]);
    expect(getByRole("button", { name: "Unstake" })).toBeEnabled();
    expect(getByRole("button", { name: "Claim rewards" })).toBeEnabled();
    expect(sozu.load).toHaveBeenCalledWith({ force: true });
  });

  it("says why Unstake and Claim rewards are off, without contradicting the history", async () => {
    withoutStake();

    const { container, queryByRole } = render(Staking);

    // Nothing staked natively: no Unstake or Claim to grey out, and the
    // stake says there's nothing to unstake or claim.
    expect(queryByRole("button", { name: "Unstake" })).toBeNull();
    expect(queryByRole("button", { name: "Claim rewards" })).toBeNull();
    expect(container.querySelector(".staking__actions")).toBeNull();
    expect(textOf(container.querySelector(".staking__figures > div"))).toBe(
      "Staked 0 DUSK Nothing to unstake or claim"
    );

    await act(() =>
      history.state?.update((s) => ({
        ...s,
        rows: [
          {
            amount: "1000000000000",
            direction: "in",
            hash: "d4".repeat(32),
            kind: "unstake",
            source: "archive",
            status: "executed",
          },
        ],
      }))
    );

    expect(textOf(container.querySelector(".staking__figures > div"))).toBe(
      "Staked 0 DUSK Nothing to unstake or claim"
    );
    expect(
      textOf(container.querySelector(".staking__side .activity-row"))
    ).toContain("Unstaked");
  });

  it("compares native and liquid staking side by side, picking neither", async () => {
    const { container, getByRole } = render(Staking);
    const table = /** @type {HTMLTableElement} */ (
      container.querySelector("table.compare")
    );
    const rows = Array.from(table.tBodies[0].rows, (row) =>
      Array.from(row.cells, textOf)
    );

    expect(Array.from(table.tHead?.rows[0].cells ?? [], textOf)).toStrictEqual([
      "",
      "Native staking",
      "Liquid staking Sozu · third party",
    ]);
    expect(rows.map(([label]) => label)).toStrictEqual([
      "Minimum",
      "Node",
      "Rewards",
      "Unstake",
      "If it goes wrong",
    ]);
    expect(rows[0].slice(1)).toStrictEqual(["1,000 DUSK", "Any amount"]);
    // A node, and the docs on running one.
    expect(rows[1].slice(1)).toStrictEqual([
      "Needs your own Dusk node Run a node",
      "Not needed",
    ]);
    expect(
      within(table).getByRole("link", { name: "Run a node" })
    ).toHaveAttribute(
      "href",
      "https://docs.dusk.network/operator/provisioner/"
    );
    // Sozu pays an unstake out at once.
    expect(rows[3].slice(1)).toStrictEqual([
      "Any time, with no waiting period",
      "The DUSK comes back in the same transaction. No fee, no waiting.",
    ]);
    expect(rows[4][1]).toBe(
      "If your node misses its turn, part of your stake gets locked. It's still yours, and unstaking returns it. If the node breaks the rules, part of the stake can be burned (lost)."
    );
    // Sozu's own site, with no terms of the wallet's about it.
    expect(rows[4][2]).toBe("sozu.fi");
    // stDUSK's worth isn't promised to rise: a penalty can lower it.
    expect(rows[2][2]).toBe(
      "You get stDUSK, a token for your share of Sozu's pool. Its worth usually rises with rewards, but can fall with a penalty."
    );

    // Nothing picked: two ways to go, neither one chosen.
    expect(
      table.querySelectorAll(
        "[aria-pressed='true'], [aria-checked='true'], [aria-selected='true'], :checked"
      )
    ).toHaveLength(0);
    expect(getByRole("link", { name: "Stake more" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/stake?flow=native"
    );
    expect(getByRole("link", { name: "Stake with Sozu" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/stake?flow=liquid"
    );

    // With the pool's rate, what a stDUSK is worth now.
    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));

    expect(textOf(table.tBodies[0].rows[2].cells[2])).toBe(
      "You get stDUSK. Each is worth 3.0751 DUSK now. It usually rises with rewards, but can fall with a penalty."
    );
    // And Sozu's fees, as its contract gives them on this network.
    expect(Array.from(table.tBodies[0].rows[3].cells, textOf)).toStrictEqual([
      "Fees",
      "Network fee only",
      "Sozu keeps 10% of rewards · 0.25% on deposits · no unstake fee",
    ]);
  });

  it("says about what each way pays a year where the choice is made: natively across the network, and with Sozu after its fee", async () => {
    rates.native = 0.235;

    try {
      const { container } = render(Staking);
      const rewards = () =>
        Array.from(
          /** @type {HTMLTableElement} */ (
            container.querySelector("table.compare")
          ).tBodies[0].rows[2].cells,
          textOf
        );

      await act(() =>
        sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS }))
      );
      await vi.waitFor(() =>
        expect(rewards()[1]).toBe(
          "About 24% a year lately, across the network. Not promised. Start in about 6 to 12 hours"
        )
      );
      // Testnet's Sozu keeps 10% of rewards: the native figure as shown,
      // 24%, less 10% of it.
      expect(rewards()[2]).toMatch(
        /^About 22% a year after Sozu's 10%\. Not promised\. You get stDUSK/
      );
      expect(container).not.toHaveTextContent(/\bEarn\b/);
    } finally {
      rates.native = null;
    }
  });

  it("gives Sozu's rate from the native one as shown, so that wherever 86% shows, 77% does", async () => {
    for (const native of [0.8605, 0.862]) {
      rates.native = native;

      try {
        const { container } = render(Staking);
        const rewards = () =>
          Array.from(
            /** @type {HTMLTableElement} */ (
              container.querySelector("table.compare")
            ).tBodies[0].rows[2].cells,
            textOf
          );

        await act(() =>
          sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS }))
        );
        await vi.waitFor(() =>
          expect(rewards()[1]).toMatch(/^About 86% a year lately/)
        );
        expect(rewards()[2]).toMatch(/^About 77% a year after Sozu's 10%\./);
      } finally {
        rates.native = null;
        cleanup();
      }
    }
  });

  it("says so while Sozu has paused deposits", async () => {
    const { queryByText } = render(Staking);

    expect(queryByText("Sozu has paused deposits.")).toBeNull();

    await act(() =>
      sozu.store?.update((s) => ({
        ...s,
        status: {
          ...SOZU_STATUS,
          flags: { maintenance: true, synchronization: false },
        },
      }))
    );

    expect(queryByText("Sozu has paused deposits.")).toBeInTheDocument();
  });

  it("says so while Sozu's deposits can't be checked", async () => {
    const { queryByText } = render(Staking);

    await act(() =>
      sozu.store?.update((s) => ({
        ...s,
        status: {
          ...SOZU_STATUS,
          flags: { maintenance: null, synchronization: false },
        },
      }))
    );

    expect(
      queryByText("Sozu's deposits couldn't be checked.")
    ).toBeInTheDocument();
    expect(queryByText("Sozu has paused deposits.")).toBeNull();
  });

  it("shows only native staking where Sozu isn't", async () => {
    await act(() => sozu.store?.update((s) => ({ ...s, available: false })));

    const { container, queryByRole } = render(Staking);

    expect(
      Array.from(container.querySelectorAll("table.compare thead th"), textOf)
    ).toStrictEqual(["Native staking"]);
    expect(queryByRole("link", { name: "Stake with Sozu" })).toBeNull();
  });

  it("shows what is staked with Sozu, and a way to unstake it", async () => {
    await act(() =>
      sozu.store?.update((s) => ({
        ...s,
        status: {
          ...SOZU_STATUS,
          position: { balance: 1_500_000_000_000n, stDusk: 487_800_000_000n },
        },
      }))
    );

    const { container, getByRole } = render(Staking);

    // Next to what is staked natively, first.
    expect(
      Array.from(container.querySelectorAll(".staking__figures > div"), textOf)
        .slice(0, 2)
        .map((text) => text?.split(" ")[0])
    ).toStrictEqual(["Staked", "With"]);
    expect(
      textOf(container.querySelectorAll(".staking__figures > div")[1])
    ).toBe("With Sozu 1,500 DUSK 487.8 stDUSK, rewards included");
    expect(
      textOf(container.querySelectorAll(".staking__figures > div")[0])
    ).toMatch(/^Staked natively /);
    // The rewards shown are the native stake's: Sozu's are in its value.
    expect(
      textOf(container.querySelectorAll(".staking__figures > div")[2])
    ).toBe("Native rewards 11,022.8426 DUSK");
    // The ways to stake come before their comparison.
    expect(
      Array.from(container.querySelectorAll(".staking__start a"), textOf)
    ).toStrictEqual(["Stake more", "Stake with Sozu"]);
    expect(getByRole("link", { name: "Unstake from Sozu" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/stake?flow=liquid&action=unstake"
    );
  });

  it("says with the native stake, not under Unstake from Sozu, that there's nothing to unstake or claim", async () => {
    withoutStake();
    await act(() =>
      sozu.store?.update((s) => ({
        ...s,
        status: {
          ...SOZU_STATUS,
          position: { balance: 499_949_044n, stDusk: 162_189_471n },
        },
      }))
    );

    const { container, getByRole } = render(Staking);
    const figures = Array.from(
      container.querySelectorAll(".staking__figures > div"),
      textOf
    );

    expect(figures.slice(0, 3)).toStrictEqual([
      "Staked natively 0 DUSK Nothing to unstake or claim",
      "With Sozu 0.4999 DUSK 0.1621 stDUSK, rewards included",
      "Native rewards 0 DUSK",
    ]);
    // Beside Unstake from Sozu, nothing that reads as its answer.
    expect(textOf(container.querySelector(".staking__actions"))).toBe(
      "Unstake from Sozu"
    );
    expect(getByRole("link", { name: "Unstake from Sozu" })).toBeVisible();
  });

  it("hides the amounts while balances are hidden", () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container } = render(Staking);

    expect(
      Array.from(container.querySelectorAll(".staking__figure"), textOf)
    ).toStrictEqual(Array(3).fill("•••• hidden"));
  });

  describe("native staking", () => {
    it("asks for an amount at once, with the minimum up front and nothing filled in", () => {
      open("?flow=native");

      const { container, getByLabelText, getByRole, queryByText } =
        render(Staking);

      expect(queryByText(/only stake if you have a node/i)).toBeNull();
      expect(getByRole("heading", { name: "Stake more" })).toBeInTheDocument();
      expect(getByLabelText("Amount to add")).toHaveValue("");

      cleanup();
      withoutStake(1_483n);

      const page2 = render(Staking);

      expect(
        page2.getByRole("heading", { name: "Native staking" })
      ).toBeInTheDocument();
      expect(page2.getByLabelText("Stake amount")).toHaveValue("");
      expect(textOf(page2.container.querySelector(".native-stake__hint"))).toBe(
        "Minimum 1,000 DUSK · Available 1,483 DUSK from your public balance"
      );
      expect(container.querySelector(".native-stake__error")).toBeNull();
    });

    it("says the minimum under the amount, with a way to use it and liquid staking inside", async () => {
      open("?flow=native");
      withoutStake(1_483n);

      const { container, getByLabelText, getByRole } = render(Staking);
      const amount = getByLabelText("Stake amount");

      await fireEvent.input(amount, { target: { value: "100" } });

      const error = container.querySelector(".native-stake__error");

      expect(error).toHaveAttribute("role", "alert");
      expect(textOf(error)).toBe(
        "The minimum stake is 1,000 DUSK. Less than 1,000 DUSK? Use liquid staking (Sozu, third party)"
      );
      expect(
        getByRole("link", {
          name: "Less than 1,000 DUSK? Use liquid staking (Sozu, third party)",
        })
      ).toHaveAttribute("href", "/some-base-path/dashboard/stake?flow=liquid");
      expect(getByRole("button", { name: "Stake" })).toBeDisabled();

      await fireEvent.click(getByRole("button", { name: "Use 1,000" }));

      expect(amount).toHaveValue("1000");
      expect(container.querySelector(".native-stake__error")).toBeNull();
      expect(
        getByRole("button", { name: "Stake 1,000 DUSK" })
      ).toBeInTheDocument();
    });

    it("says at once when the public balance is below the minimum, and doesn't fill in more than there is", () => {
      open("?flow=native");
      withoutStake(172n);

      const { container, getByLabelText, queryByRole } = render(Staking);

      expect(getByLabelText("Stake amount")).toHaveValue("");
      expect(queryByRole("button", { name: "Use 1,000" })).toBeNull();
      expect(textOf(container.querySelector(".native-stake__note"))).toBe(
        "Your public balance doesn't cover the 1,000 DUSK minimum and the network fee. Less than 1,000 DUSK? Use liquid staking (Sozu, third party)"
      );
    });

    it("says how much more an amount needs, with the network fee", async () => {
      open("?flow=native");
      withoutStake(1_483n);

      const { container, getByLabelText } = render(Staking);

      await fireEvent.input(getByLabelText("Stake amount"), {
        target: { value: "1483" },
      });

      expect(textOf(container.querySelector(".native-stake__error"))).toBe(
        "That's 0.05 DUSK more than the public balance, with the network fee."
      );
    });
  });

  it("stakes with Sozu from liquid staking", async () => {
    open("?flow=liquid");
    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));

    const { container, getByLabelText, getByRole } = render(Staking);

    expect(sozu.load).toHaveBeenCalledWith();

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });

    // For what's left once testnet's 0.25% deposit fee is off it.
    expect(textOf(container.querySelector(".liquid-stake__estimate"))).toBe(
      "You get about 32.4378 stDUSK, worth about 99.75 DUSK now. stDUSK is Sozu's token for your share. Its DUSK value follows Sozu's pool, its rewards and its fees."
    );
    expect(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    ).toBeEnabled();
    // A stake's own gas: up to 5,000,000 at the node's price.
    expect(textOf(container.querySelector(".stake-flow__rows--total"))).toBe(
      "Total Up to 100.005 DUSK"
    );

    await fireEvent.click(getByRole("tab", { name: "Unstake" }));

    // An unstake's: up to 10,000,000, as it can touch more provisioners.
    expect(textOf(container.querySelector(".stake-flow__rows--total"))).toBe(
      "Total Up to 0.01 DUSK"
    );
  });

  it("reads Sozu again before a stake goes, and stakes on the terms it read", async () => {
    open("?flow=liquid");
    await act(() => sozu.store?.update((s) => ({ ...s, status: SOZU_STATUS })));
    sozu.check.mockResolvedValue(SOZU_STATUS);

    const stakeWithSozu = vi
      .spyOn(walletStore, "stakeWithSozu")
      .mockReturnValue(new Promise(() => {}));
    const { getByLabelText, getByRole } = render(Staking);

    await fireEvent.input(getByLabelText("Stake amount"), {
      target: { value: "100" },
    });
    await fireEvent.click(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    );

    await vi.waitFor(() => expect(stakeWithSozu).toHaveBeenCalledOnce());
    expect(sozu.check).toHaveBeenCalledOnce();
    expect(stakeWithSozu.mock.calls[0].slice(0, 2)).toStrictEqual([
      POOL,
      100_000_000_000n,
    ]);
  });
});
