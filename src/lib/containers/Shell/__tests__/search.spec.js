import { describe, expect, it } from "vitest";
import { networks } from "@dusk-network/networks";

import {
  rowOf,
  rowsOf,
  withBridge,
} from "$lib/activity/__tests__/fixtures/rows";
import { dayLabel, timeLabel } from "$lib/activity/present";

import {
  isAmountQuery,
  lookupKind,
  lookupName,
  searchLocally,
  transactionsFound,
} from "../search";

const ALICE =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const OWN =
  "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";

/** @type {import("../search").SearchIndex} */
const index = {
  history: [
    rowOf({
      amount: "500000000",
      counterpartyName: "alice.dusk",
      direction: "in",
      from: ALICE,
      hash: "dc3f73".padEnd(64, "0"),
      status: "executed",
    }),
  ],
  locale: "en",
  pages: [
    { href: "/dashboard", label: "Home" },
    { href: "/dashboard/send", keywords: "pay", label: "Send" },
  ],
  profiles: [
    {
      account: OWN,
      address:
        "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG",
      label: "Profile 1",
      name: "wallet-both.dusk",
    },
  ],
};

describe("searchLocally", () => {
  it("offers the pages before anything is typed", () => {
    expect(searchLocally("", index).map((r) => r.label)).toEqual([
      "Home",
      "Send",
    ]);
  });

  it("finds pages, profiles, people and transactions on this device", () => {
    expect(searchLocally("pay", index)).toEqual([
      expect.objectContaining({ group: "Pages", href: "/dashboard/send" }),
    ]);
    expect(searchLocally("wallet-both", index)).toEqual([
      expect.objectContaining({
        group: "Your profiles",
        label: "Profile 1 · wallet-both.dusk",
        value: OWN,
      }),
    ]);
    // Enter sends to a person; Shift+Enter copies the address. Their payments
    // come under them.
    expect(searchLocally("alice", index)).toEqual([
      expect.objectContaining({
        group: "People",
        hint: "Send",
        href: `/dashboard/send?to=${ALICE}`,
        label: "alice.dusk",
        value: ALICE,
      }),
      expect.objectContaining({
        detail: "+0.5 DUSK",
        group: "Transactions",
        label: "alice.dusk",
      }),
    ]);
    expect(searchLocally("dc3f73", index)).toEqual([
      expect.objectContaining({
        detail: "dc3f73…000000",
        group: "Transactions",
        href: `/dashboard/transactions?tx=${"dc3f73".padEnd(64, "0")}`,
        label: "alice.dusk",
        sub: undefined,
      }),
    ]);
  });

  it("names the history's transactions as History does, with when it was made under it, not a call's method", () => {
    const BRIDGE = "22".repeat(32);
    const deposit = {
      amount: "100000000",
      bridge: {
        amount: "100000000",
        kind: "deposit",
        to: "0xb0E8340000000000000000000000000000f8C6b0",
      },
      contractId: BRIDGE,
      fnName: "depositETHToWithValue",
      hash: "40c50a".padEnd(64, "1"),
      kind: "contract_call",
      status: "executed",
      timestamp: Date.UTC(2026, 10, 3, 21, 16),
    };
    const proof = {
      ...deposit,
      amount: "0",
      bridge: null,
      fnName: "proveWithdrawalTransaction",
      hash: "fdc37b".padEnd(64, "2"),
    };
    const bridged = {
      ...index,
      history: rowsOf([deposit, proof], {
        network: withBridge(networks.testnet, BRIDGE),
      }),
    };

    expect(
      searchLocally("40c50a", bridged).map(({ detail, label, sub }) => [
        label,
        sub,
        detail,
      ])
    ).toEqual([
      [
        "To DuskEVM",
        `${dayLabel(deposit.timestamp, { locale: "en" })}, ${timeLabel(deposit.timestamp, "en")}`,
        "40c50a…111111",
      ],
    ]);
    expect(searchLocally("fdc37b", bridged)).toEqual([
      expect.objectContaining({
        label: "Withdrawal proved",
        sub: `${dayLabel(proof.timestamp, { locale: "en" })}, ${timeLabel(proof.timestamp, "en")}`,
      }),
    ]);
  });
});

describe("searchLocally for what was paid", () => {
  const MARTA =
    "qxwSidKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

  /** @type {Contact} */
  const marta = {
    address: MARTA,
    createdAt: 1,
    id: "marta",
    name: "Estudio Marta",
    type: "account",
    updatedAt: 1,
  };

  /** @type {import("../search").SearchIndex} */
  const paid = {
    ...index,
    contacts: [marta],
    history: rowsOf([
      {
        amount: "120500000000",
        direction: "in",
        from: MARTA,
        hash: "a1".repeat(32),
        status: "executed",
      },
      {
        amount: "120000000000",
        direction: "in",
        from: ALICE,
        hash: "a2".repeat(32),
        status: "executed",
      },
      {
        amount: "12345678",
        counterparty: MARTA,
        hash: "a3".repeat(32),
        status: "executed",
      },
      {
        amount: "1000000000000",
        counterparty: ALICE,
        counterpartyName: "alice.dusk",
        hash: "a4".repeat(32),
        status: "executed",
      },
      {
        amount: "1000000000",
        counterparty: ALICE,
        counterpartyName: "alice.dusk",
        hash: "a5".repeat(32),
        status: "executed",
      },
    ]),
    locale: "es-ES",
    present: { contactNames: new Map([[MARTA, marta.name]]) },
  };

  /**
   * What a search finds of the transactions, as hashes' first byte.
   *
   * @param {string} query
   * @param {import("../search").SearchIndex} [where]
   */
  const paymentsFor = (query, where = paid) =>
    searchLocally(query, where)
      .filter(({ group }) => group === "Transactions")
      .map(({ detail, label, value }) => [value?.slice(0, 2), label, detail]);

  it("finds a payment by its amount as it's written here, with the amount typed first, to the lux", () => {
    expect(paymentsFor("120")).toEqual([
      ["a2", expect.anything(), "+120 DUSK"],
      ["a1", "Estudio Marta", "+120,5 DUSK"],
    ]);
  });

  it("finds an amount the row shows cut, with a comma or a point", () => {
    expect(paymentsFor("0,0123")).toEqual([
      ["a3", "Estudio Marta", "−0,0123 DUSK"],
    ]);
    expect(paymentsFor("0.0123")).toEqual([
      ["a3", "Estudio Marta", "−0,0123 DUSK"],
    ]);
  });

  it("looks for both amounts that a text can mean", () => {
    expect(paymentsFor("1.000").map(([hash]) => hash)).toEqual(["a4", "a5"]);
    expect(
      paymentsFor("1 000", { ...paid, locale: "fr-FR" }).map(([hash]) => hash)
    ).toEqual(["a4"]);
  });

  it("finds nothing for an amount no payment has, and doesn't take it for a name", () => {
    expect(paymentsFor("7,5")).toEqual([]);
    expect(lookupKind("7,5")).toBeNull();
    expect(lookupKind("0.0123")).toBeNull();
    expect(lookupKind("1 000")).toBeNull();
    expect(lookupKind("120")).toBe("name");
    expect(isAmountQuery("0.0123", "en")).toBe(true);
    expect(isAmountQuery("alice", "en")).toBe(false);
  });

  it("lists a contact's payments under the contact, by name, by address or by a .dusk name a row has", () => {
    expect(
      searchLocally("Estudio", paid).map(({ group, value }) => [
        group,
        value?.slice(0, 2),
      ])
    ).toEqual([
      ["Contacts", undefined],
      ["Transactions", "a1"],
      ["Transactions", "a3"],
    ]);
    expect(paymentsFor("qxwSid").map(([hash]) => hash)).toEqual(["a1", "a3"]);
    expect(paymentsFor("alice").map(([hash]) => hash)).toEqual([
      "a2",
      "a4",
      "a5",
    ]);
  });

  it("hides what they moved while balances are hidden", () => {
    expect(paymentsFor("120", { ...paid, hideBalances: true })).toEqual([
      ["a2", expect.anything(), "+•••• DUSK"],
      ["a1", "Estudio Marta", "+•••• DUSK"],
    ]);
  });
});

describe("searchLocally for a block, a memo or a label", () => {
  const SOZU_POOL =
    "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";

  /** @type {import("../search").SearchIndex} */
  const withMore = {
    ...index,
    history: [
      ...index.history,
      ...rowsOf([
        {
          amount: "1000000000",
          contractId: SOZU_POOL,
          fnName: "stake",
          hash: "5d".repeat(32),
          kind: "contract_call",
          status: "executed",
        },
        {
          amount: "2000000000",
          counterparty: ALICE,
          hash: "e1".repeat(32),
          memo: "Rent for October",
          status: "executed",
        },
      ]),
    ],
    network: "testnet",
  };

  it("offers a block height, digits only, as a block to open in the explorer", () => {
    expect(searchLocally("4704959", withMore)).toEqual([
      expect.objectContaining({
        block: "4704959",
        group: "Blocks",
        label: "Open block 4,704,959 in the explorer",
      }),
    ]);
    expect(
      searchLocally("4704959x", withMore).filter(
        ({ group }) => group === "Blocks"
      )
    ).toEqual([]);
  });

  it("lists five transactions at most, and the rest in History, where the same are found", () => {
    const invoices = {
      ...index,
      history: [1, 2, 3, 4, 5, 6, 7].map((n) =>
        rowOf({
          amount: "10000000",
          direction: "in",
          from: ALICE,
          hash: `b${n}`.repeat(32),
          memo: `Factura 2026-05${n}`,
          status: "executed",
        })
      ),
    };
    const found = searchLocally("Factura 2026-05", invoices).filter(
      ({ group }) => group === "Transactions"
    );

    expect(found).toHaveLength(6);
    expect(found.at(-1)).toStrictEqual({
      group: "Transactions",
      href: "/dashboard/transactions?q=Factura%202026-05",
      id: "tx:all",
      label: "See all 7 in History",
    });
    expect(
      transactionsFound("Factura 2026-05", invoices).map(({ row }) => row.hash)
    ).toStrictEqual(invoices.history.map(({ hash }) => hash));

    // Five or fewer: nothing more to see.
    expect(
      searchLocally("Factura 2026-051", invoices).map(({ id }) => id)
    ).toStrictEqual([`tx:${"b1".repeat(32)}`]);
  });

  it("finds the history's transactions by memo, and by the label of their contract or account", () => {
    expect(
      searchLocally("sozu", withMore).map(({ group, href }) => [group, href])
    ).toEqual([
      ["Transactions", `/dashboard/transactions?tx=${"5d".repeat(32)}`],
    ]);
    expect(
      searchLocally("october", withMore).map(({ group, href }) => [group, href])
    ).toEqual([
      ["Transactions", `/dashboard/transactions?tx=${"e1".repeat(32)}`],
    ]);
  });
});

describe("searchLocally with contacts", () => {
  it("finds contacts by name, .dusk name or address, and shows a saved person as the contact, with their payments", () => {
    /** @type {Contact} */
    const contact = {
      address: ALICE,
      createdAt: 1,
      duskName: "alice.dusk",
      id: "alice",
      name: "Alice",
      type: "account",
      updatedAt: 1,
    };
    const withContacts = { ...index, contacts: [contact] };

    expect(searchLocally("alice", withContacts)).toEqual([
      expect.objectContaining({
        detail: "alice.dusk",
        group: "Contacts",
        href: "/dashboard/contacts?contact=alice",
        label: "Alice",
      }),
      expect.objectContaining({ detail: "+0.5 DUSK", group: "Transactions" }),
    ]);
    expect(searchLocally(ALICE.slice(4, 14), withContacts)).toEqual([
      expect.objectContaining({ group: "Contacts", label: "Alice" }),
      expect.objectContaining({ group: "Transactions" }),
    ]);
  });
});

describe("lookupKind", () => {
  it("tells what a query can be looked up as on the network", () => {
    expect(lookupKind("alise.dusk")).toBe("name");
    expect(lookupKind(` ${"ab".repeat(32)} `)).toBe("transaction");
    expect(lookupKind(`0x${"ab".repeat(32)}`)).toBe("transaction");
    expect(lookupKind(ALICE)).toBe("address");
    expect(lookupKind("bad_name")).toBeNull();
    expect(lookupKind("two words")).toBeNull();
  });

  it("looks a name typed without .dusk, or with a dot after it, up as its .dusk name", () => {
    expect(lookupKind("bakery")).toBe("name");
    expect(lookupName("bakery")).toBe("bakery.dusk");
    expect(lookupName("alice.dusk.")).toBe("alice.dusk");
    expect(lookupName(" Alice.Dusk ")).toBe("Alice.Dusk");
  });
});
