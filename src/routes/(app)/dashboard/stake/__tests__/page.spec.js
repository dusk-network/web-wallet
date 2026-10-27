import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { settingsStore } from "$lib/stores";

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

const POOL = "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";

/** Sozu as read on testnet: about 3.0751 DUSK a stDUSK. */
const SOZU_STATUS = {
  contracts: { hub: "bae8".padEnd(64, "0"), pool: POOL, stDusk: null },
  pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
  position: { balance: 0n, stDusk: 0n },
};

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

    const { container, getByRole } = render(Staking);

    expect(getByRole("button", { name: "Unstake" })).toBeDisabled();
    expect(getByRole("button", { name: "Claim rewards" })).toBeDisabled();
    expect(textOf(container.querySelector(".staking__actions"))).toContain(
      "Nothing staked yet, so there's nothing to unstake or claim."
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

    expect(textOf(container.querySelector(".staking__actions"))).toContain(
      "Nothing staked right now, so there's nothing to unstake or claim."
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
    expect(rows[3].slice(1)).toStrictEqual([
      "Any time, with no waiting period",
      "Sozu, not Dusk, holds the DUSK and returns it under Sozu's own rules.",
    ]);
    expect(rows[4][1]).toBe(
      "If your node misses its turn, part of your stake gets locked. It's still yours, and unstaking returns it. If the node breaks the rules, part of the stake can be burned (lost)."
    );
    expect(rows[2][2]).toBe(
      "You get stDUSK, a token for your share of Sozu's pool. Its DUSK value follows the pool."
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
      "You get stDUSK. Each is worth 3.0751 DUSK now, as Sozu's contract gives it, and follows Sozu's pool."
    );
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

    expect(
      textOf(container.querySelectorAll(".staking__figures > div")[3])
    ).toBe("With Sozu 1,500 DUSK 487.8 stDUSK");
    expect(getByRole("link", { name: "Unstake from Sozu" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/stake?flow=liquid&action=unstake"
    );
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

    expect(textOf(container.querySelector(".liquid-stake__estimate"))).toBe(
      "You get about 32.5191 stDUSK, at the rate Sozu's contract gives now. stDUSK is Sozu's token for your share. Its DUSK value follows Sozu's pool, its rewards and its fees."
    );
    expect(
      getByRole("button", { name: "Stake 100 DUSK with Sozu" })
    ).toBeEnabled();
  });
});
