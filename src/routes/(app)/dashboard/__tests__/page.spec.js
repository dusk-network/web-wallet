import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { settingsStore } from "$lib/stores";

import Dashboard from "../+page.svelte";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(() => Promise.resolve()),
}));

const network = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  store: null,
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  network.store = writable({ connected: true, networkName: "mainnet" });

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      subscribe: network.store.subscribe,
    },
    walletStore: {
      ...mockedWalletStore,
      startHistory: () => ({ refresh: mocks.refresh }),
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

/** @type {ActivityRow[]} */
const rows = [
  {
    amount: "5000000000",
    direction: "out",
    hash: "a1".repeat(32),
    kind: "transfer",
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
    kind: "transfer",
    privacy: "public",
    source: "archive",
    status: "executed",
    success: true,
    timestamp: NOW - 60_000,
  },
  {
    amount: "200000000000",
    blockHeight: 4_686_000,
    direction: "out",
    feePaid: "3700000",
    hash: "c3".repeat(32),
    kind: "transfer",
    privacy: "public",
    source: "archive",
    status: "failed",
    success: false,
    timestamp: NOW - 120_000,
    to: ALICE,
  },
];

/** @param {Partial<import("$lib/activity/activitySession").ActivityState>} state */
const setHistory = (state) =>
  act(() => history.state?.update((current) => ({ ...current, ...state })));

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
    await setHistory({ error: null, loaded: true, rows: [], syncing: false });
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    vi.doUnmock("$lib/stores");
    vi.doUnmock("$lib/activity");
    vi.doUnmock("$lib/sozu");
  });

  it("shows the total balance, its public and shielded parts, and every action", async () => {
    const { container, getByRole } = render(Dashboard, props);

    expect(container.querySelector(".home-balance__amount")).toHaveTextContent(
      "3,517.5"
    );
    expect(container.querySelector(".home-balance__legend")).toHaveTextContent(
      "Public 1,172.5 Shielded 2,345"
    );

    for (const [name, href] of [
      ["Send", "/dashboard/send"],
      ["Receive", "/dashboard/receive"],
      ["Shield", "/dashboard/allocate"],
      ["Stake", "/dashboard/stake"],
      ["Bridge", "/dashboard/bridge"],
    ]) {
      expect(getByRole("link", { name })).toHaveAttribute(
        "href",
        `/some-base-path${href}`
      );
    }

    await vi.waitFor(() =>
      expect(container.querySelector(".home-balance__fiat")).toHaveTextContent(
        "≈ $1,758.75"
      )
    );
  });

  it("shows no value in money off mainnet, as test DUSK has none", async () => {
    network.store?.set({ connected: true, networkName: "testnet" });

    const { container } = render(Dashboard, props);

    await props.data.currentPrice;
    await act(() => {});

    expect(container.querySelector(".home-balance__fiat")).toBeNull();

    network.store?.set({ connected: true, networkName: "mainnet" });
  });

  it("says what each balance means, and that nothing is staked right now", async () => {
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });

    const { getByText, queryByRole } = render(Dashboard, props);

    expect(
      getByText("Visible on chain. Staking and the bridge use this balance.")
    ).toBeInTheDocument();
    expect(
      getByText("Amounts and accounts stay hidden on chain.")
    ).toBeInTheDocument();
    expect(getByText("Nothing staked right now")).toBeInTheDocument();
    expect(
      getByText(
        "From 1,000 DUSK with your own node, or any amount with Sozu (third party)."
      )
    ).toBeInTheDocument();
    expect(queryByRole("link", { name: "Past staking" })).toBeNull();

    // Staked before: no "yet", and a way to what was staked.
    await setHistory({
      rows: [
        { ...rows[1], direction: "out", hash: "d4".repeat(32), kind: "stake" },
      ],
    });

    expect(queryByRole("link", { name: "Past staking" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/transactions?kind=staking"
    );
  });

  it("counts staking with Sozu as staking, and shows what is staked there", async () => {
    const { currentProfile } = initialStore;

    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });
    sozu.load.mockClear();

    const { container, queryByRole } = render(Dashboard, props);

    expect(sozu.load).not.toHaveBeenCalled();

    await setHistory({
      rows: [
        {
          amount: "1500000000000",
          blockHeight: 4_687_000,
          contractId:
            "6fdfdc713a18fc6ca2ad20eb2b4a3305a935ef47d6a872d9a4df8bc9fd9d169e",
          direction: "out",
          fnName: "sozu_stake",
          hash: "e5".repeat(32),
          kind: "contract_call",
          privacy: "public",
          source: "archive",
          status: "executed",
          success: true,
          timestamp: NOW,
        },
      ],
    });

    // Staked before, with Sozu: a way to it, and Sozu read for what is there.
    expect(queryByRole("link", { name: "Past staking" })).toBeInTheDocument();
    expect(sozu.load).toHaveBeenCalled();

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
      })
    );

    expect(container.querySelectorAll(".explainer-card")[2]).toHaveTextContent(
      "Staking 1,500 DUSK with Sozu Liquid staking through Sozu, a third party. Open staking"
    );

    // Another profile's position isn't this one's.
    await act(() =>
      sozu.store?.update((state) => ({ ...state, account: "another" }))
    );

    expect(container.querySelectorAll(".explainer-card")[2]).toHaveTextContent(
      "Nothing staked right now"
    );
  });

  it("shows what is staked and its rewards", () => {
    const { container } = render(Dashboard, props);

    expect(container.querySelectorAll(".explainer-card")[2]).toHaveTextContent(
      "Staking 1,000 DUSK staked Rewards: 11,022.8426 DUSK Open staking"
    );
  });

  it("lists the latest activity: pending, received and failed, which moved nothing", async () => {
    await setHistory({ rows });

    const { container, getByRole } = render(Dashboard, props);
    const items = () =>
      Array.from(container.querySelectorAll(".activity-row"), (row) =>
        row.textContent?.replace(/\s+/g, " ").trim()
      );

    expect(items()).toEqual([
      expect.stringMatching(
        /^alice-shop\.dusk Sent · .+ · Public −5 DUSK Pending$/
      ),
      expect.stringMatching(
        /^wallet-both\.dusk Received · .+ · Public \+50 DUSK$/
      ),
      `${ALICE.slice(0, 6)}…${ALICE.slice(-6)} Failed · nothing sent · fee 0.0037 DUSK paid · Public 200 DUSK`,
    ]);
    expect(container.querySelector(".activity-row")).toHaveAttribute(
      "href",
      `/some-base-path/dashboard/transactions?tx=${"a1".repeat(32)}`
    );

    await fireEvent.click(getByRole("button", { name: "Received" }));

    expect(items()).toEqual([
      expect.stringMatching(/^wallet-both\.dusk Received/),
    ]);
  });

  it("hides amounts while balances are hidden, but not a fee", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));
    await setHistory({ rows: [rows[2]] });

    const { container } = render(Dashboard, props);

    expect(container.querySelector(".home-balance__amount")).toHaveTextContent(
      "•••• hidden"
    );
    expect(container.querySelector(".activity-row")).toHaveTextContent(
      "fee 0.0037 DUSK paid · Public •••• hidden DUSK"
    );
    expect(get(settingsStore).hideBalances).toBe(true);
  });

  it("says when the history couldn't be read, and tries again", async () => {
    await setHistory({ error: "fetch failed", rows: [] });

    const { getByRole, getByText } = render(Dashboard, props);

    expect(
      getByText("Couldn't reach the network's history.")
    ).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("shows the activity unless the history is switched off", () => {
    vi.stubEnv("VITE_FEATURE_TRANSACTION_HISTORY", "");

    const shown = render(Dashboard, props);

    expect(
      shown.container.querySelector(".activity-panel")
    ).toBeInTheDocument();

    cleanup();
    vi.stubEnv("VITE_FEATURE_TRANSACTION_HISTORY", "false");

    const hidden = render(Dashboard, props);

    expect(hidden.container.querySelector(".activity-panel")).toBeNull();
    expect(
      hidden.getByText(
        "Transaction history isn't available here yet. The Dusk explorer has your transactions."
      )
    ).toBeInTheDocument();
  });
});
