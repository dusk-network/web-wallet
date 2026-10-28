import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";

import { listContacts, removeContact, saveContact } from "$lib/contacts";

import History from "../+page.svelte";

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  loadDetail: vi.fn(() => Promise.resolve()),
  showMore: vi.fn(() => Promise.resolve()),
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

vi.mock("$lib/navigation", async (importOriginal) => ({
  .../** @type {typeof import("$lib/navigation")} */ (await importOriginal()),
  goto: mocks.goto.mockImplementation((/** @type {string} */ path) => {
    stores.page?.set({
      url: new URL(`http://localhost/some-base-path${path}`),
    });
  }),
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

/** @type {ActivityRow[]} */
const rows = [
  {
    amount: "25000000000",
    blockHeight: 4_687_600,
    direction: "out",
    feePaid: "1854786",
    gasLimit: "2500000",
    gasSpent: "1854786",
    hash: SENT,
    kind: "transfer",
    memo: "Order 1042",
    privacy: "public",
    source: "archive",
    status: "executed",
    success: true,
    timestamp: NOW - 60_000,
    to: ALICE,
    toName: "alice-shop.dusk",
  },
  {
    amount: "50000000000",
    blockHeight: 4_687_500,
    counterpartyName: "wallet-both.dusk",
    direction: "in",
    from: ALICE,
    hash: RECEIVED,
    kind: "transfer",
    privacy: "shielded",
    source: "shielded",
    status: "executed",
    timestamp: NOW - 120_000,
  },
  {
    amount: "1000000000000",
    blockHeight: 4_600_000,
    direction: "out",
    hash: STAKED,
    kind: "stake",
    privacy: "public",
    source: "archive",
    status: "executed",
    success: true,
    timestamp: NOW - 10 * 86_400_000,
  },
];

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
      .map((selector) =>
        row.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim()
      )
      .join(" ")
  );

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

  it("lists the history by day, with each row's type, time in its zone and amount", () => {
    const { container, getByRole } = render(History);

    expect(
      getByRole("columnheader", { name: /^Time \(.+\)$/ })
    ).toBeInTheDocument();
    expect(container.querySelector(".history__day")).toHaveTextContent(
      /^Today · /
    );
    expect(shownRows(container)).toEqual([
      expect.stringMatching(/^alice-shop\.dusk Sent Public .+ −25 DUSK$/),
      expect.stringMatching(
        /^wallet-both\.dusk Received Shielded .+ \+50 DUSK$/
      ),
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
      expect.stringMatching(/^wallet-both\.dusk/),
    ]);
  });

  it("opens a transaction's details, in full, and closes them", async () => {
    const { container, getByRole, getByText, queryByRole } = render(History);

    await fireEvent.click(getByRole("button", { name: /alice-shop\.dusk/ }));

    expect(mocks.goto).toHaveBeenCalledWith(
      `/dashboard/transactions?tx=${SENT}`,
      expect.objectContaining({ replaceState: true })
    );
    expect(mocks.loadDetail).toHaveBeenCalledWith(SENT);

    const detail = /** @type {HTMLElement} */ (
      container.querySelector(".tx-detail")
    );

    expect(getByText("Sent to alice-shop.dusk")).toBeInTheDocument();
    expect(getByText("Completed")).toBeInTheDocument();
    expect(detail).toHaveTextContent("Memo Order 1042");
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

    await fireEvent.click(getByRole("button", { name: "Close the details" }));

    expect(queryByRole("button", { name: "Close the details" })).toBeNull();
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

  it("exports the rows shown as CSV", async () => {
    /** @type {Blob[]} */
    const blobs = [];

    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(/** @type {Blob} */ (blob));

      return "blob:history";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await visit("/dashboard/transactions?kind=staking");

    const { getByRole } = render(History);

    await fireEvent.click(getByRole("button", { name: "Export CSV" }));

    const lines = (await blobs[0].text()).split("\r\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Date \(UTC\),Date \(local\),Block,/);
    expect(lines[1]).toContain(`,${STAKED},out,Public,Staked (Staking),`);
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
