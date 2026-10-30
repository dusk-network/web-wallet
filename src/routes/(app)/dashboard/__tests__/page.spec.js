import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { settingsStore } from "$lib/stores";

import Dashboard from "../+page.svelte";
import { networks } from "@dusk-network/networks";

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

  it("offers whoever holds DUSK on Ethereum or BNB Smart Chain a migration, only where one is running: BNB Smart Chain's on mainnet", async () => {
    const { getByRole, unmount } = render(Dashboard, props);

    expect(getByRole("link", { name: "Migrate it to Dusk" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/bridge?route=bsc-to-dusk"
    );
    unmount();

    // Testnet's migration, from Sepolia, isn't running: no line.
    network.store?.set({
      connected: true,
      net: networks.testnet,
      networkName: "testnet",
    });

    const { container, queryByRole } = render(Dashboard, props);

    expect(queryByRole("link", { name: "Migrate it to Dusk" })).toBeNull();
    expect(container).not.toHaveTextContent("Have DUSK on Ethereum");

    network.store?.set({
      connected: true,
      net: networks.mainnet,
      networkName: "mainnet",
    });
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
        rowOf({
          ...FIELDS[1],
          direction: "out",
          hash: "d4".repeat(32),
          kind: "stake",
        }),
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
        // Mainnet's pool.
        rowOf(
          {
            amount: "1500000000000",
            blockHeight: 4_687_000,
            contractId:
              "6fdfdc713a18fc6ca2ad20eb2b4a3305a935ef47d6a872d9a4df8bc9fd9d169e",
            fnName: "sozu_stake",
            hash: "e5".repeat(32),
            kind: "contract_call",
            status: "executed",
            timestamp: NOW,
          },
          { network: networks.mainnet }
        ),
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

  it("reads Sozu for an account that called a pool its hub may have named", async () => {
    sozu.load.mockClear();
    render(Dashboard, props);

    await setHistory({
      rows: [
        rowOf({
          amount: "1000000000",
          blockHeight: 4_687_000,
          contractId: "ef".repeat(32),
          fnName: "sozu_stake",
          hash: "e6".repeat(32),
          kind: "contract_call",
          status: "executed",
          timestamp: NOW,
        }),
      ],
    });

    expect(sozu.load).toHaveBeenCalled();
  });

  it("says under the total what is staked, natively and with Sozu, and nothing while none is", async () => {
    const { currentProfile } = initialStore;
    const staked = () =>
      document.querySelector(".home-balance__staked")?.textContent?.trim();
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
        })
      );

    // Natively: 1,000 DUSK.
    render(Dashboard, props);

    expect(staked()).toMatch(/^Staked\s+1,000\s+DUSK$/);

    // And 0.5002 DUSK with Sozu: both counted.
    await withSozu(500_200_000n);

    expect(staked()).toMatch(/^Staked\s+1,000.5002\s+DUSK$/);

    // Hidden with the other balances.
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, hideBalances: true }))
    );

    expect(staked()).toMatch(/^Staked\s+••••\s+hidden\s+DUSK$/);

    cleanup();
    settingsStore.reset();
    await withSozu(0n);

    // With Sozu alone, then nothing staked at all: no line.
    mockedWalletStore.setMockedStoreValue({
      ...initialStore,
      stakeInfo: { ...initialStore.stakeInfo, amount: null },
    });
    render(Dashboard, props);

    expect(staked()).toBeUndefined();

    await withSozu(500_200_000n);

    expect(staked()).toMatch(/^Staked\s+0.5002\s+DUSK$/);

    await act(() =>
      sozu.store?.update((state) => ({ ...state, status: null }))
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
