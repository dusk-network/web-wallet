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
import { hydrateExportAddresses } from "$lib/activity/exportAddresses";
import { shortAddress } from "$lib/activity/present";
import { listContacts, removeContact, saveContact } from "$lib/contacts";
import {
  forgetVerifiedNames,
  keepVerifiedName,
} from "$lib/dusk-domains/verifiedNames";
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
  /** @type {import("vitest").Mock<() => Promise<any>>} */
  sozuStatus: vi.fn(async () => null),
  whole: vi.fn(),
}));

const stores = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  history: null,

  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,

  /** The profile shown: its public account and shielded address. */
  profile: { account: "account-shown", address: "address-shown" },
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  stores.page = writable({
    url: new URL("http://localhost/some-base-path/dashboard/transactions"),
  });

  return { page: stores.page };
});

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
      // A profile shown, as the history and its export are of one.
      subscribe: (/** @type {(value: any) => void} */ run) =>
        original.walletStore.subscribe((value) =>
          run({
            ...value,
            currentProfile: stores.profile,
            profiles: [stores.profile],
          })
        ),
    },
  };
});

// What Sozu says the account holds now, as read for the rewards by year.
vi.mock("$lib/sozu", async (importOriginal) => {
  /** @type {typeof import("$lib/sozu")} */
  const original = await importOriginal();

  return {
    ...original,
    sozuStore: { ...original.sozuStore, check: mocks.sozuStatus },
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

  it("asks at Save about a counterparty's name another contact's starts as, saving it only once answered", async () => {
    // Lucas's old phone, saved as a contact before.
    const OLD_PHONE =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";

    saveContact({ address: OLD_PHONE, name: "Shop (old phone)" });

    const { getByRole, queryByRole } = render(History);

    await fireEvent.click(getByRole("button", { name: /^alice-shop\.dusk/ }));
    await fireEvent.click(getByRole("button", { name: "Save to contacts" }));
    await fireEvent.input(getByRole("textbox", { name: "Contact name" }), {
      target: { value: "Shop" },
    });

    expect(getByRole("alert")).toHaveTextContent(
      `You have a contact called Shop (old phone), at ${shortAddress(OLD_PHONE)}. Is this someone else?`
    );

    await fireEvent.click(getByRole("button", { name: "Save" }));

    expect(listContacts()).toHaveLength(1);
    expect(getByRole("button", { name: "Yes, save it" })).toHaveFocus();

    await fireEvent.click(getByRole("button", { name: "Yes, save it" }));

    expect(listContacts()).toStrictEqual([
      expect.objectContaining({ address: ALICE, name: "Shop" }),
      expect.objectContaining({ address: OLD_PHONE }),
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
      setNodeNetwork(null);
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
      expect(names).toStrictEqual([
        expect.stringMatching(
          /^dusk-profile-1-testnet-all-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/
        ),
      ]);
      expect(mocks.whole).toHaveBeenCalledOnce();

      await vi.waitFor(() =>
        expect(queryByRole("button", { name: "Save CSV" })).toBeNull()
      );
    });

    it("names the file and its Account Name as the extension does: by the profile's .dusk name, else its name here, with when it was made", async () => {
      vi.useFakeTimers({
        now: new Date(2026, 10, 11, 23, 43, 20),
        toFake: ["Date"],
      });
      keepVerifiedName("testnet", "account-shown", "sofiadesign.dusk");

      try {
        const { getByRole } = await openExport();

        await fireEvent.click(getByRole("button", { name: "Save CSV" }));

        const { head, lines } = await fileSaved();
        const accountName = head.indexOf("Account Name");

        expect(names).toStrictEqual([
          "dusk-sofiadesign-dusk-testnet-all-2026-11-11-2343.csv",
        ]);
        expect(
          new Set(lines.map((line) => line.split(",")[accountName]))
        ).toStrictEqual(new Set(["sofiadesign.dusk"]));
      } finally {
        forgetVerifiedNames();
        vi.useRealTimers();
      }
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

    it("says the network fees of migrations the file has, and those it couldn't read, as the file made for its period has them, once saved too, and takes an EVM address added for its files, kept after a lock", async () => {
      const ADDED = "0x90fe2f14bbdd4bbb68ad0ce1a7b6c1b4d6bf4b39";
      const ANOTHERS = "0x7cdb2f14bbdd4bbb68ad0ce1a7b6c1b4d6bf8e73";
      const MIGRATION = `0x${"a7".repeat(32)}`;
      const BSC = /** @type {any} */ (
        networks.mainnet.routes.migrations?.find(
          ({ id }) => id === "bsc-to-dusk"
        )
      );
      const { toastList } = await import("$lib/dusk/components/Toast/store");
      const { forgetRouteTransfers, rememberMigration } =
        await import("$lib/bridge/migrationActivity");

      /** What the panel says of the file's network fees, once it's read. */
      const feesSaid = async (/** @type {HTMLElement} */ container) => {
        /** @type {string} */
        let said = "";

        await vi.waitFor(() => {
          said =
            container
              .querySelector(".export-panel__evm .export-panel__note")
              ?.textContent?.trim() ?? "";

          expect(said).toMatch(/^(?!Reading)./);
        });

        return said;
      };

      setNodeNetwork(networks.mainnet);
      // A migration this browser sent another profile, from its own address.
      rememberMigration({
        amountLux: "5000000000",
        createdAt: NOW - 3_600_000,
        hash: `0x${"a9".repeat(32)}`,
        recipient: "another",
        routeId: "bsc-to-dusk",
        sender: ANOTHERS,
      });
      // One that came to this profile, whose chain doesn't answer.
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

      try {
        const { container, getByRole } = await openExport();

        // Made for its period as the panel opens: what it holds, not a guess
        // from the addresses known here.
        const said = await feesSaid(container);

        expect(said).toBe(
          "1 migration's fee on BNB Smart Chain couldn't be read. Some network fees couldn't be read."
        );
        expect(said).not.toMatch(/0x7cdb/i);

        // Added for the file: what it isn't is said, what it is is listed.
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
          getByRole("list", { name: "EVM addresses added" })
        ).toHaveTextContent(/0x90fE…4b39/i);

        const withAdded = await feesSaid(container);

        // Saved, it says the same of the file, and that another export adds
        // what couldn't be read.
        toastList.set([]);
        await fireEvent.click(getByRole("button", { name: "Save CSV" }));
        await vi.waitFor(() => expect(names).toHaveLength(1));
        await vi.waitFor(() =>
          expect(get(toastList).map(({ message }) => message)).toEqual([
            expect.stringContaining(
              withAdded
                .replace(
                  "couldn't be read.",
                  "couldn't be read: export again to add it."
                )
                .replace(
                  /couldn't be read\.$/,
                  "couldn't be read: export again to add them."
                )
            ),
          ])
        );

        // Kept for this profile, through a lock and an unlock, as it opens
        // the wallet's records again.
        cleanup();
        hydrateExportAddresses();

        const unlocked = render(History);

        await fireEvent.click(unlocked.getByRole("button", { name: "Export" }));

        expect(
          unlocked.getByRole("list", { name: "EVM addresses added" })
        ).toHaveTextContent(/0x90fE…4b39/i);

        // And Remove takes it off this one's.
        await fireEvent.click(
          unlocked.getByRole("button", { name: `Remove ${ADDED}` })
        );

        expect(
          unlocked.queryByRole("list", { name: "EVM addresses added" })
        ).toBeNull();
        expect(hydrateExportAddresses()).toStrictEqual({});
      } finally {
        stores.profile = { account: "account-shown", address: "address-shown" };
        localStorage.removeItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-export-evm`);
        hydrateExportAddresses();
        forgetRouteTransfers();
        setNodeNetwork(null);
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
      expect(names[0]).toMatch(
        /-\d{4}-q[1-4](-testnet)?-\d{4}-\d{2}-\d{2}-\d{4}\.csv$/
      );
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
      // Mainnet, where DUSK has a price.
      setNodeNetwork(networks.mainnet);

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

    it("shows staking rewards by year beside the file, in DUSK, and in the wallet's currency as asked under them, saving nothing", async () => {
      // Mainnet, where DUSK has a price.
      setNodeNetwork(networks.mainnet);

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
          [june + 3_600_000, "5250000000", "e4"],
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
      // Half a euro a DUSK at each time asked: the claim's, the unstake's, now.
      const prices = vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              prices: [june, june + 3_600_000, NOW].map((at) => [at, 0.5]),
            })
          )
        )
      );

      // Lena's: 10 DUSK into Sozu, 0.025 of it its fee, for 5 stDUSK at
      // 1.995 DUSK each; half of them gave back 5.25 DUSK at 2.1, and the
      // rest is worth 5.5 DUSK now, at 2.2. Grown while held: 0.775 DUSK,
      // all Sozu says the stake earned; taken out by unstaking: 0.25, what
      // came back less what that half cost with its fee, 5 DUSK.
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
            [
              stake.hash,
              {
                fee: 25_000_000n,
                pool: { stake: 1_995n, supply: 1_000n },
                stDusk: 5_000_000_000n,
              },
            ],
            [
              unstake.hash,
              { pool: { stake: 21n, supply: 10n }, stDusk: 2_500_000_000n },
            ],
          ])
        )
      );
      mocks.sozuStatus.mockResolvedValue({
        contracts: { pool: "ab".repeat(32) },
        pool: { stake: 22n, supply: 10n },
        position: { balance: 5_500_000_000n, stDusk: 2_500_000_000n },
      });
      vi.stubGlobal("fetch", prices);
      settingsStore.update((store) => ({ ...store, currency: "EUR" }));

      try {
        const { container, getByRole } = await openExport();
        const years = () =>
          Array.from(
            container.querySelectorAll(".rewards-by-year tbody tr"),
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
            [`${year - 1}`, "1 DUSK", "0 DUSK", "0 DUSK"],
            [`${year}`, "2 DUSK", "0.775 DUSK", "0.25 DUSK"],
          ])
        );
        expect(
          Array.from(
            container.querySelectorAll(".rewards-by-year thead th"),
            (cell) => cell.textContent?.trim()
          )
        ).toStrictEqual([
          "Year",
          "Native staking, claimed",
          "Sozu, grown while held",
          "Sozu, taken out by unstaking",
        ]);
        // How what unstaking took out is counted, under them.
        expect(container).toHaveTextContent(
          "Taken out by unstaking is part of grown while held: what came back, less that stDUSK's average cost, deposit fees included."
        );
        expect(prices).not.toHaveBeenCalled();

        // The file's values ask nothing of them.
        await fireEvent.click(
          getByRole("checkbox", { name: /^Add each payment's value in euros/ })
        );

        expect(prices).not.toHaveBeenCalled();

        // Their own, under them: read again with each one's value.
        await fireEvent.click(
          getByRole("checkbox", {
            name: "Add each reward's value in euros, from CoinGecko's prices",
          })
        );
        await vi.waitFor(() =>
          expect(years()).toStrictEqual([
            [
              `${year - 1}`,
              "1 DUSK · no euro value",
              "0 DUSK · €0.00",
              "0 DUSK · €0.00",
            ],
            [
              `${year}`,
              "2 DUSK · €1.00",
              "0.775 DUSK · €0.39",
              "0.25 DUSK · €0.13",
            ],
          ])
        );
        // The panel stays, with no file.
        expect(names).toStrictEqual([]);
        expect(getByRole("button", { name: "Save CSV" })).toBeEnabled();

        // Hidden with the balances, in DUSK and in euros alike.
        settingsStore.update((store) => ({ ...store, hideBalances: true }));
        await vi.waitFor(() =>
          expect(years()).toStrictEqual([
            [
              `${year - 1}`,
              "•••• hidden DUSK · no euro value",
              "•••• hidden DUSK · •••• hidden",
              "•••• hidden DUSK · •••• hidden",
            ],
            [
              `${year}`,
              "•••• hidden DUSK · •••• hidden",
              "•••• hidden DUSK · •••• hidden",
              "•••• hidden DUSK · •••• hidden",
            ],
          ])
        );
        settingsStore.update((store) => ({ ...store, hideBalances: false }));

        // In a currency without cents, what's worth less than its least
        // shows as under that.
        settingsStore.update((store) => ({ ...store, currency: "JPY" }));
        await vi.waitFor(() =>
          getByRole("checkbox", { name: /reward's value in Japanese yen/ })
        );
        await fireEvent.click(
          getByRole("button", { name: "Show staking rewards by year" })
        );
        await vi.waitFor(() =>
          expect(years()).toStrictEqual([
            [
              `${year - 1}`,
              "1 DUSK · no Japanese yen value",
              "0 DUSK · ¥0",
              "0 DUSK · ¥0",
            ],
            [
              `${year}`,
              "2 DUSK · ¥1",
              "0.775 DUSK · under ¥1",
              "0.25 DUSK · under ¥1",
            ],
          ])
        );
      } finally {
        mocks.sozuFacts.mockImplementation(() => Promise.resolve(new Map()));
        mocks.sozuStatus.mockResolvedValue(null);
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
      // Mainnet, where DUSK has a price.
      setNodeNetwork(networks.mainnet);

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

    it("gives no value in a currency on testnet, whose DUSK has none, saying so where it's asked, and asks CoinGecko nothing", async () => {
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
      setNodeNetwork(networks.testnet);
      settingsStore.update((store) => ({ ...store, currency: "EUR" }));

      try {
        const { container, getByRole, getByText } = await openExport();
        const fileValues = getByRole("checkbox", {
          name: /^Add each payment's value in euros/,
        });

        expect(fileValues).toBeDisabled();
        expect(fileValues).not.toBeChecked();
        expect(getByText("Test DUSK has no value.")).toBeInTheDocument();

        await fireEvent.click(getByRole("button", { name: "Save CSV" }));
        await vi.waitFor(() => expect(names).toHaveLength(1));

        expect(await blobs[0].text()).not.toContain(",EUR,");

        // Nor the staking rewards by year beside it: a reward claimed.
        mocks.whole.mockResolvedValue({
          rows: rowsOf([
            {
              amount: "1000000000",
              blockHeight: 4_000_000,
              direction: "in",
              hash: "e1".repeat(32),
              kind: "withdraw_reward",
              status: "executed",
              timestamp: NOW - 86_400_000,
            },
          ]),
          shieldedWaiting: false,
        });
        await fireEvent.click(getByRole("button", { name: "Export" }));
        await fireEvent.click(
          getByRole("button", { name: "Show staking rewards by year" })
        );

        const rewardValues = await vi.waitFor(() =>
          getByRole("checkbox", {
            name: "Add each reward's value in euros, from CoinGecko's prices",
          })
        );

        expect(rewardValues).toBeDisabled();
        expect(
          container.querySelector(
            ".rewards-by-year__option + .rewards-by-year__note"
          )
        ).toHaveTextContent("Test DUSK has no value.");
        expect(
          prices.mock.calls.filter(([url]) => String(url).includes("coingecko"))
        ).toStrictEqual([]);
      } finally {
        settingsStore.reset();
        vi.unstubAllGlobals();
      }
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
