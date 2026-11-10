import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import { networks } from "@dusk-network/networks";

import { rowsOf } from "$lib/activity/__tests__/fixtures/rows";
import { shortAddress } from "$lib/activity/present";
import { listContacts, removeContact, saveContact } from "$lib/contacts";
import { settingsStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { openTestContacts } from "$lib/test-helpers";

import History from "../+page.svelte";

/** Where Back goes: the addresses a step of its own left behind. */
const visited = vi.hoisted(() => /** @type {any[]} */ ([]));

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  loadDetail: vi.fn(() => Promise.resolve()),
  showMore: vi.fn(() => Promise.resolve()),
  sozuFacts: vi.fn(() => Promise.resolve(new Map())),
  whole: vi.fn(),
}));

const stores = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  history: null,

  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  stores.page = writable({
    url: new URL("http://localhost/some-base-path/dashboard/transactions"),
  });

  return { page: stores.page };
});

// What each migration did on its own chain, as its chain says it.
const migrationEvm = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<(...args: any[]) => Promise<Map<string, any>>>} */
  read: vi.fn(async () => new Map()),
}));

vi.mock("$lib/bridge/migrationEvm", () => ({
  readMigrationsEvm: migrationEvm.read,
}));

vi.mock("$lib/navigation/goto", () => ({
  default: mocks.goto.mockImplementation(
    (/** @type {string} */ path, /** @type {any} */ { state } = {}) => {
      visited.push(get(/** @type {any} */ (stores.page)));
      stores.page?.set({
        state,
        url: new URL(`http://localhost/some-base-path${path}`),
      });
    }
  ),
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: true, networkName: "testnet" }),
    },
    walletStore: {
      ...original.walletStore,
      startHistory: () => ({
        loadDetail: mocks.loadDetail,
        showMore: mocks.showMore,
        sozuFacts: mocks.sozuFacts,
        whole: mocks.whole,
      }),
    },
  };
});

vi.mock("$lib/activity", async (importOriginal) => {
  /** @type {typeof import("$lib/activity")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  stores.history = writable({});

  return { ...original, activityState: stores.history };
});

const ALICE =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const SENT = "a1".repeat(32);
const RECEIVED = "b2".repeat(32);
const STAKED = "c3".repeat(32);
const NOW = Date.now();

// Sent from here, to a name typed for it; received shielded; and staked.
const rows = rowsOf([
  {
    amount: "25000000000",
    blockHeight: 4_687_600,
    feePaid: "1854786",
    gasLimit: "2500000",
    gasSpent: "1854786",
    hash: SENT,
    memo: "Order 1042",
    privacy: "public",
    source: "both",
    status: "executed",
    timestamp: NOW - 60_000,
    to: ALICE,
    toName: "alice-shop.dusk",
  },
  {
    amount: "50000000000",
    blockHeight: 4_687_500,
    direction: "in",
    hash: RECEIVED,
    source: "shielded",
    status: "executed",
    timestamp: NOW - 120_000,
  },
  {
    amount: "1000000000000",
    blockHeight: 4_600_000,
    hash: STAKED,
    kind: "stake",
    status: "executed",
    timestamp: NOW - 10 * 86_400_000,
  },
]);

/** @param {Partial<import("$lib/activity/activitySession").ActivityState>} state */
const setHistory = (state) =>
  act(() =>
    stores.history?.set({
      complete: true,
      error: null,
      hasMore: false,
      loaded: true,
      rows,
      syncing: false,
      ...state,
    })
  );

/** @param {string} path */
const visit = (path) =>
  act(() =>
    stores.page?.set({ url: new URL(`http://localhost/some-base-path${path}`) })
  );

/**
 * The rows shown: their name, line, type, time and amount.
 *
 * @param {HTMLElement} container
 */
const shownRows = (container) =>
  Array.from(container.querySelectorAll(".history__row"), (row) =>
    [
      ".history__name",
      ".history__line",
      ".history__col-type",
      ".history__col-time",
      ".history__amount",
    ]
      .map((selector) => {
        const cell = row.querySelector(selector);
        // A line's own text: its time and type repeat in it for phones only.
        const text =
          selector === ".history__line"
            ? cell?.firstChild?.textContent
            : cell?.textContent;

        return text?.replace(/\s+/g, " ").trim();
      })
      .join(" ")
  );

// The contacts open with a wallet, as when it unlocks.
beforeAll(() => openTestContacts());

describe("History", () => {
  beforeEach(async () => {
    await setHistory({});
    await visit("/dashboard/transactions");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();

    for (const contact of listContacts()) {
      removeContact(contact.id);
    }
  });

  it("lists the history by day, with each row's type, local time and amount", () => {
    const { container, getByRole } = render(History);

    expect(getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
    expect(container.querySelector(".history__day")).toHaveTextContent(
      /^Today · /
    );
    expect(shownRows(container)).toEqual([
      expect.stringMatching(/^alice-shop\.dusk Sent Public .+ −25 DUSK$/),
      expect.stringMatching(/^Received Received Shielded .+ \+50 DUSK$/),
      expect.stringMatching(/^Staked Staking Public .+ −1,000 DUSK$/),
    ]);
  });

  it("filters by what a row did, from the address too, and by privacy", async () => {
    await visit("/dashboard/transactions?kind=staking");

    const { container, getByRole } = render(History);

    expect(shownRows(container)).toEqual([expect.stringMatching(/^Staked/)]);

    await fireEvent.click(getByRole("button", { name: "All" }));
    await fireEvent.change(
      getByRole("combobox", { name: "Public or shielded" }),
      {
        target: { value: "shielded" },
      }
    );

    expect(shownRows(container)).toEqual([
      expect.stringMatching(/^Received Received Shielded/),
    ]);
  });

  it("keeps its filters in its address, for a refresh, Back or a link, and goes back to the default for any that isn't one", async () => {
    await visit(
      "/dashboard/transactions?kind=received&privacy=shielded&range=30"
    );

    const { container, getByRole } = render(History);
    const dates = getByRole("combobox", { name: "Dates" });
    const privacy = getByRole("combobox", { name: "Public or shielded" });

    expect(getByRole("button", { name: "Received" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(privacy).toHaveValue("shielded");
    expect(dates).toHaveValue("30");
    expect(shownRows(container)).toEqual([
      expect.stringMatching(/^Received Received Shielded/),
    ]);

    // Picked here, it goes in the address, with the defaults left out.
    await fireEvent.click(getByRole("button", { name: "Staking" }));

    expect(mocks.goto).toHaveBeenLastCalledWith(
      "/dashboard/transactions?kind=staking&privacy=shielded&range=30",
      expect.objectContaining({ replaceState: true })
    );

    await fireEvent.change(dates, { target: { value: "all" } });

    expect(mocks.goto).toHaveBeenLastCalledWith(
      "/dashboard/transactions?kind=staking&privacy=shielded",
      expect.objectContaining({ replaceState: true })
    );

    // None of them a filter: each one's default.
    await visit("/dashboard/transactions?kind=fees&privacy=both&range=365");

    expect(getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(privacy).toHaveValue("all");
    expect(dates).toHaveValue("all");
  });

  it("opens a transaction's details, in full, and closes them", async () => {
    const { container, getByRole, getByText, queryByRole } = render(History);

    await fireEvent.click(getByRole("button", { name: /alice-shop\.dusk/ }));

    // A step of its own in the browser's history, for Back to close.
    expect(mocks.goto).toHaveBeenCalledWith(
      `/dashboard/transactions?tx=${SENT}`,
      expect.not.objectContaining({ replaceState: true })
    );
    expect(mocks.loadDetail).toHaveBeenCalledWith(SENT);

    const detail = /** @type {HTMLElement} */ (
      container.querySelector(".tx-detail")
    );

    expect(getByText("Sent to alice-shop.dusk")).toBeInTheDocument();
    expect(getByText("Completed")).toBeInTheDocument();
    expect(detail).toHaveTextContent("Memo Order 1042");
    // In its details, to the last digit.
    expect(detail).toHaveTextContent("Network fee paid 0.001854786 DUSK");

    // The hash in full, its ending kept on one line.
    expect(detail.querySelector(".tx-detail__id")).toHaveTextContent(SENT);
    expect(
      detail.querySelector(".tx-detail__id .tx-detail__tail")
    ).toHaveTextContent(SENT.slice(-6));
    expect(
      getByRole("link", { name: "View in Dusk explorer" })
    ).toHaveAttribute("href", `/explorer/transactions/transaction?id=${SENT}`);
    expect(getByRole("link", { name: "Send again" })).toHaveAttribute(
      "href",
      `/some-base-path/dashboard/send?to=${ALICE}`
    );

    // Its close takes that step back, as Back does.
    const back = vi
      .spyOn(history, "go")
      .mockImplementation((/** @type {any} */ steps) => {
        expect(steps).toBe(-1);
        stores.page?.set(visited.pop());
      });

    await fireEvent.click(getByRole("button", { name: "Close the details" }));

    expect(back).toHaveBeenCalledOnce();
    expect(queryByRole("button", { name: "Close the details" })).toBeNull();

    back.mockRestore();
  });

  it("closes details it didn't open itself in place, as from a link: there's no list behind them", async () => {
    await visit(`/dashboard/transactions?tx=${SENT}`);

    const { getByRole } = render(History);
    const back = vi.spyOn(history, "go");

    await fireEvent.click(getByRole("button", { name: "Close the details" }));

    expect(back).not.toHaveBeenCalled();
    expect(mocks.goto).toHaveBeenLastCalledWith(
      "/dashboard/transactions",
      expect.objectContaining({ replaceState: true })
    );

    back.mockRestore();
  });

  it("names a saved contact by its name, with its .dusk name second, and saves a counterparty as a contact", async () => {
    saveContact({ address: ALICE, name: "Alice's shop" });

    const { container, getByRole, queryByRole } = render(History);

    expect(shownRows(container)[0]).toMatch(
      /^Alice's shop · alice-shop\.dusk Sent/
    );

    await fireEvent.click(
      getByRole("button", { name: /^Alice's shop · alice-shop\.dusk/ })
    );

    expect(container.querySelector(".tx-detail")).toHaveTextContent(
      "Sent to Alice's shop · alice-shop.dusk"
    );
    expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();

    await act(() => removeContact(listContacts()[0].id));
    await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
    await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
      target: { value: "Shop" },
    });
    await fireEvent.click(getByRole("button", { name: "Save" }));

    expect(listContacts()).toStrictEqual([
      expect.objectContaining({
        address: ALICE,
        duskName: "alice-shop.dusk",
        name: "Shop",
      }),
    ]);
    expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();
  });

  it("marks a contact whose name looks like another's with its address, as Send does, and shows one's hidden characters as codes", async () => {
    saveContact({ address: ALICE, name: "Estudio Marta" });
    // A Cyrillic а, saved after the warning, for another address.
    saveContact({ address: "x".repeat(40), name: "Estudio M\u0430rta" });

    const { container, getByRole, rerender } = render(History);
    const mark = `${shortAddress(ALICE)} · name looks like another`;

    expect(container.querySelector(".history__row")).toHaveTextContent(
      `Estudio Marta · alice-shop.dusk ${mark}`
    );
    expect(
      getByRole("button", {
        name: new RegExp(`^Estudio Marta · alice-shop\\.dusk, ${mark}`),
      })
    ).toBeInTheDocument();

    for (const contact of listContacts()) {
      await act(() => removeContact(contact.id));
    }

    // Saved before such names were refused: it reads as "Alice".
    await act(() => saveContact({ address: ALICE, name: "\u202EecilA" }));
    await rerender({});

    expect(shownRows(container)[0]).toMatch(
      /^\\u202eecilA · alice-shop\.dusk Sent/
    );
  });

  it("says who paid the fee of what was received", async () => {
    await visit(`/dashboard/transactions?tx=${RECEIVED}`);

    const { container, queryByRole } = render(History);

    expect(container.querySelector(".tx-detail")).toHaveTextContent(
      "Network fee paid Paid by the sender"
    );
    expect(queryByRole("link", { name: "Send again" })).toBeNull();
  });

  it("shows more history on request", async () => {
    await setHistory({ hasMore: true });

    const { getByRole } = render(History);

    await fireEvent.click(getByRole("button", { name: "Show more" }));

    expect(mocks.showMore).toHaveBeenCalledOnce();
  });

  describe("Export", () => {
    /** @type {Blob[]} */
    let blobs;

    /** @type {string[]} */
    let names;

    beforeEach(() => {
      blobs = [];
      names = [];
      mocks.whole.mockResolvedValue({ rows, shieldedWaiting: false });
      vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
        blobs.push(/** @type {Blob} */ (blob));

        return "blob:history";
      });
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        /** @this {HTMLAnchorElement} */
        function () {
          names.push(this.download);
        }
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      mocks.whole.mockReset();
    });

    /** Opens Export, and gives the page's controls. */
    async function openExport() {
      const view = render(History);

      await fireEvent.click(view.getByRole("button", { name: "Export" }));

      return view;
    }

    /** The file saved last, by its columns. */
    async function fileSaved() {
      await vi.waitFor(() => expect(blobs).not.toHaveLength(0));

      const [head, ...lines] = (await /** @type {Blob} */ (blobs.at(-1)).text())
        .replace(/^\uFEFF/, "")
        .trimEnd()
        .split("\r\n");

      return { head: head.split(","), lines };
    }

    it("saves the file a tax tool reads, of all the history read whole, in UTC, named after the profile, and closes", async () => {
      const { getByRole, queryByRole } = await openExport();

      expect(getByRole("button", { name: "Export" })).toHaveAttribute(
        "aria-expanded",
        "true"
      );

      await fireEvent.click(getByRole("button", { name: "Save CSV" }));

      const { head, lines } = await fileSaved();

      expect(head.slice(0, 3)).toStrictEqual([
        "Date",
        "Sent Amount",
        "Sent Currency",
      ]);
      expect(head).toContain("Internal Transfer");
      expect(lines.join("\n")).toContain("Order 1042");
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},/);
      expect(names).toStrictEqual(["dusk-profile-testnet-all.csv"]);
      expect(mocks.whole).toHaveBeenCalledOnce();

      await vi.waitFor(() =>
        expect(queryByRole("button", { name: "Save CSV" })).toBeNull()
      );
    });

    it("starts with a BOM only for Excel, and adds contact names only as asked", async () => {
      saveContact({ address: ALICE, name: "Alice Rent" });
      mocks.whole.mockResolvedValue({
        rows: rowsOf([
          {
            amount: "1000000000",
            blockHeight: 4_687_700,
            hash: "d4".repeat(32),
            privacy: "public",
            source: "both",
            status: "executed",
            timestamp: NOW - 1000,
            to: ALICE,
          },
        ]),
        shieldedWaiting: false,
      });

      const { getByRole } = await openExport();

      await fireEvent.click(getByRole("button", { name: "Save CSV" }));

      await vi.waitFor(() => expect(names).toHaveLength(1));

      const first = new Uint8Array(await blobs[0].arrayBuffer());

      expect(Array.from(first.slice(0, 3))).not.toStrictEqual([
        0xef, 0xbb, 0xbf,
      ]);
      expect(await blobs[0].text()).not.toContain("Alice Rent");

      await fireEvent.click(getByRole("button", { name: "Export" }));
      await fireEvent.click(
        getByRole("checkbox", { name: /Add my contact names/ })
      );
      await fireEvent.click(getByRole("checkbox", { name: /^For Excel/ }));
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));
      await vi.waitFor(() => expect(names).toHaveLength(2));

      const second = new Uint8Array(await blobs[1].arrayBuffer());

      expect(Array.from(second.slice(0, 3))).toStrictEqual([0xef, 0xbb, 0xbf]);
      expect(await blobs[1].text()).toContain("Alice Rent");
    });

    it("says which EVM addresses it has migrations' network fees from, and takes one added for the file", async () => {
      const ADDED = "0x90fe2f14bbdd4bbb68ad0ce1a7b6c1b4d6bf4b39";
      const MIGRATION = `0x${"a7".repeat(32)}`;
      const BSC = /** @type {any} */ (
        networks.mainnet.routes.migrations?.find(
          ({ id }) => id === "bsc-to-dusk"
        )
      );

      setNodeNetwork(networks.mainnet);
      mocks.whole.mockResolvedValue({
        rows: rowsOf(
          [
            {
              amount: "5000000000",
              blockHeight: 4_700_000,
              counterparty: BSC.payoutAccount,
              direction: "in",
              hash: "bd".repeat(32),
              memo: MIGRATION,
              status: "executed",
              timestamp: NOW - 60_000,
            },
          ],
          { network: networks.mainnet }
        ),
        shieldedWaiting: false,
      });
      migrationEvm.read.mockImplementation(
        async () =>
          new Map([
            [
              MIGRATION,
              {
                approval: null,
                approvalState: "none",
                at: NOW - 120_000,
                block: 10,
                coin: "BNB",
                from: ADDED,
                gasWei: 47_005_000_752_080n,
                hash: MIGRATION,
                lux: 5_000_000_000n,
                route: "bsc-to-dusk",
                state: "mined",
                totalWei: 47_005_000_752_080n,
              },
            ],
          ])
      );

      try {
        const { getByRole, getByText } = await openExport();
        const fees = async () =>
          (await fileSaved()).lines.filter((line) => line.includes(",cost,"));

        expect(
          getByText(
            "The file has no network fees of migrations: no EVM address of yours is known here."
          )
        ).toBeInTheDocument();

        await fireEvent.click(getByRole("button", { name: "Save CSV" }));

        expect(await fees()).toStrictEqual([]);

        // Added for the file: what it isn't is said, what it is is listed.
        await fireEvent.click(getByRole("button", { name: "Export" }));
        await fireEvent.click(
          getByRole("button", { name: "Add an EVM address" })
        );

        const field = getByRole("textbox", {
          name: "EVM address you migrated from",
        });

        await fireEvent.input(field, { target: { value: "0x90fe" } });
        await fireEvent.click(getByRole("button", { name: "Add" }));

        expect(getByRole("alert")).toHaveTextContent(
          "That isn't an EVM address."
        );

        await fireEvent.input(field, { target: { value: ADDED } });
        await fireEvent.click(getByRole("button", { name: "Add" }));

        expect(
          getByText(
            /^The file has the network fees your migrations paid from 0x90fE…4b39\.$/i
          )
        ).toBeInTheDocument();

        await fireEvent.click(getByRole("button", { name: "Save CSV" }));
        await vi.waitFor(() => expect(names).toHaveLength(2));

        expect(await fees()).toEqual([
          expect.stringContaining(
            "Network fee on BNB Smart Chain: migration of 5 BEP20 DUSK to Dusk"
          ),
        ]);
      } finally {
        setNodeNetwork(null);
        migrationEvm.read.mockReset();
      }
    });

    it("holds a quarter or the dates chosen, and says so, saving nothing, with nothing in them", async () => {
      const { findByRole, getByLabelText, getByRole } = await openExport();

      await fireEvent.change(getByRole("combobox", { name: "Period" }), {
        target: { value: "dates" },
      });

      // Both days first.
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));

      expect(await findByRole("alert")).toHaveTextContent("Choose both days.");
      expect(mocks.whole).not.toHaveBeenCalled();

      await fireEvent.input(getByLabelText("From"), {
        target: { value: "2020-01-01" },
      });
      await fireEvent.input(getByLabelText("To"), {
        target: { value: "2020-03-31" },
      });
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));
      await vi.waitFor(() =>
        expect(getByRole("alert")).toHaveTextContent(
          "There's nothing in that period, so nothing was saved."
        )
      );
      expect(blobs).toHaveLength(0);

      // This quarter holds what was sent a minute ago.
      await fireEvent.change(getByRole("combobox", { name: "Period" }), {
        target: {
          value: `${new Date(NOW).getFullYear()}-${Math.floor(new Date(NOW).getMonth() / 3) + 1}`,
        },
      });
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));

      const { lines } = await fileSaved();

      expect(lines.join("\n")).toContain("Order 1042");
      expect(names[0]).toMatch(/-\d{4}-q[1-4](-testnet)?\.csv$/);
    });

    it("says it can't read the whole history, and saves nothing half read", async () => {
      mocks.whole.mockRejectedValueOnce(new Error("fetch failed"));

      const { findByRole, getByRole } = await openExport();

      await fireEvent.click(getByRole("button", { name: "Save CSV" }));

      expect(await findByRole("alert")).toHaveTextContent(
        "Couldn't read your whole history from this node, so nothing was saved. Try again."
      );
      expect(blobs).toHaveLength(0);
    });

    it("asks CoinGecko only when euros are asked for, in euros as the wallet's amounts are, for no more than times", async () => {
      const prices = vi.fn((/** @type {string} */ url) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              prices: String(url).includes("coingecko")
                ? [[NOW - 60_000, 0.25]]
                : [],
            })
          )
        )
      );

      vi.stubGlobal("fetch", prices);
      settingsStore.update((store) => ({ ...store, currency: "EUR" }));

      const { getByRole } = await openExport();

      prices.mockClear();
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));
      await vi.waitFor(() => expect(names).toHaveLength(1));

      expect(prices).not.toHaveBeenCalled();

      await fireEvent.click(getByRole("button", { name: "Export" }));
      await fireEvent.click(getByRole("checkbox", { name: /in euros/ }));
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));
      await vi.waitFor(() => expect(names).toHaveLength(2));

      const asked = prices.mock.calls.map(([url]) => String(url));

      expect(asked.length).toBeGreaterThan(0);

      for (const url of asked) {
        expect(url).toMatch(
          /^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/dusk-network\/market_chart\/range\?vs_currency=eur&from=\d+&to=\d+$/
        );
      }

      const text = await blobs[1].text();

      expect(text).toContain(",EUR,");
      settingsStore.reset();
      vi.unstubAllGlobals();
    });

    it("shows staking rewards by year beside the file, in DUSK, and in the wallet's currency where asked, saving nothing", async () => {
      // Mid-year, whatever the device's time zone: one a year and a half
      // ago, past CoinGecko's year, and the rest this year.
      const year = new Date(NOW).getUTCFullYear();
      const old = Date.UTC(year - 1, 5, 15);
      const june = Date.UTC(year, 5, 15);
      const read = rowsOf(
        [
          [old, "1000000000", "e1"],
          [june, "2000000000", "e2"],
          [june - 90 * 86_400_000, "10000000000", "e3"],
          [june + 3_600_000, "10500000000", "e4"],
        ].map(([timestamp, amount, hash], i) => ({
          amount,
          blockHeight: 4_000_000 + i,
          direction: i === 2 ? "out" : "in",
          hash: String(hash).repeat(32),
          kind: i < 2 ? "withdraw_reward" : "transfer",
          status: "executed",
          timestamp,
        }))
      );
      /** @param {string} hash */
      const rowOf = (hash) =>
        /** @type {(typeof read)[number]} */ (
          read.find((row) => row.hash === hash.repeat(32))
        );
      const [stake, unstake] = [rowOf("e3"), rowOf("e4")];
      const prices = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ prices: [[june, 0.5]] })))
      );

      // 10 DUSK into Sozu, 0.025 of it its fee, for 5 stDUSK, all of which
      // gave back 10.5 DUSK: 0.525 DUSK earned, taken out.
      mocks.whole.mockResolvedValue({
        rows: [
          rowOf("e1"),
          rowOf("e2"),
          { ...stake, sozu: "stake" },
          { ...unstake, sozu: "unstake" },
        ],
        shieldedWaiting: false,
      });
      mocks.sozuFacts.mockImplementation(() =>
        Promise.resolve(
          new Map([
            [stake.hash, { fee: 25_000_000n, stDusk: 5_000_000_000n }],
            [unstake.hash, { stDusk: 5_000_000_000n }],
          ])
        )
      );
      vi.stubGlobal("fetch", prices);
      settingsStore.update((store) => ({ ...store, currency: "EUR" }));

      try {
        const { container, getByRole } = await openExport();
        const years = () =>
          Array.from(
            container.querySelectorAll(".export-panel__years tbody tr"),
            (row) =>
              Array.from(
                /** @type {HTMLTableRowElement} */ (row).cells,
                (cell) => cell.textContent?.trim()
              )
          );

        await fireEvent.click(
          getByRole("button", { name: "Show staking rewards by year" })
        );
        await vi.waitFor(() =>
          expect(years()).toStrictEqual([
            [`${year - 1}`, "1 DUSK", "0 DUSK"],
            [`${year}`, "2 DUSK", "0.525 DUSK"],
          ])
        );
        expect(prices).not.toHaveBeenCalled();

        await fireEvent.click(getByRole("checkbox", { name: /in euros/ }));
        await fireEvent.click(
          getByRole("button", { name: "Show staking rewards by year" })
        );
        await vi.waitFor(() =>
          expect(years()).toStrictEqual([
            [`${year - 1}`, "1 DUSK · no euro value", "0 DUSK · €0.00"],
            [`${year}`, "2 DUSK · €1.00", "0.525 DUSK · €0.26"],
          ])
        );
        // The panel stays, with no file.
        expect(names).toStrictEqual([]);
        expect(getByRole("button", { name: "Save CSV" })).toBeEnabled();
      } finally {
        mocks.sozuFacts.mockImplementation(() => Promise.resolve(new Map()));
        settingsStore.reset();
        vi.unstubAllGlobals();
      }
    });

    it.each([
      ["US dollars as the wallet's amounts", "USD", "de-DE", "US dollars"],
      [
        "the wallet's own currency, as Indian rupees in India",
        "INR",
        "en-IN",
        "Indian rupees",
      ],
      [
        "the wallet's own currency, not the browser's region's",
        "SGD",
        "de-DE",
        "Singapore dollars",
      ],
      [
        "the browser's region's, for a currency of no price",
        "XYZ",
        "de-DE",
        "euros",
      ],
    ])("gives the values in %s", async (_, currency, language, words) => {
      const code =
        { euros: "EUR", "Indian rupees": "INR", "Singapore dollars": "SGD" }[
          words
        ] ?? "USD";
      const prices = vi.fn((/** @type {string} */ url) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              prices: String(url).includes("coingecko")
                ? [[NOW - 60_000, 0.25]]
                : [],
            })
          )
        )
      );

      vi.stubGlobal("fetch", prices);
      vi.spyOn(navigator, "language", "get").mockReturnValue(language);
      settingsStore.update((store) => ({ ...store, currency }));

      const { getByRole } = await openExport();

      await fireEvent.click(
        getByRole("checkbox", {
          name: `Add each payment's value in ${words}, from CoinGecko's prices (the past year)`,
        })
      );
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));
      await vi.waitFor(() => expect(names).toHaveLength(1));

      for (const [url] of prices.mock.calls) {
        expect(String(url)).toContain(`vs_currency=${code.toLowerCase()}&`);
      }

      expect(await blobs[0].text()).toContain(`,${code},`);
      settingsStore.reset();
      vi.unstubAllGlobals();
    });
  });

  it("says when there is nothing yet, or the history couldn't be read", async () => {
    await setHistory({ rows: [] });

    const { getByText } = render(History);

    expect(getByText("No transactions yet.")).toBeInTheDocument();

    await setHistory({ error: "fetch failed", rows: [] });

    expect(
      getByText("Couldn't reach the network's history.")
    ).toBeInTheDocument();
  });
});
