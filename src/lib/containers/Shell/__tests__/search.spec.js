import { describe, expect, it } from "vitest";

import { lookupKind, lookupName, searchLocally } from "../search";

const ALICE =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const OWN =
  "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";

/** @type {import("../search").SearchIndex} */
const index = {
  history: [
    {
      amount: "500000000",
      counterpartyName: "alice.dusk",
      direction: "in",
      from: ALICE,
      hash: "dc3f73".padEnd(64, "0"),
      kind: "transfer",
      source: "archive",
      status: "executed",
    },
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
    // Enter sends to a person; Shift+Enter copies the address.
    expect(searchLocally("alice", index)).toEqual([
      expect.objectContaining({
        group: "People",
        hint: "Send",
        href: `/dashboard/send?to=${ALICE}`,
        label: "alice.dusk",
        value: ALICE,
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

  it("names the history's transactions as History does, with a call's method under it", () => {
    const BRIDGE = "22".repeat(32);
    const deposit = /** @type {ActivityRow} */ ({
      amount: "100000000",
      bridge: {
        amount: "100000000",
        kind: "deposit",
        to: "0xb0E8340000000000000000000000000000f8C6b0",
      },
      contractId: BRIDGE,
      direction: "out",
      fnName: "depositETHToWithValue",
      hash: "40c50a".padEnd(64, "1"),
      kind: "contract_call",
      source: "archive",
      status: "executed",
    });
    const proof = /** @type {ActivityRow} */ ({
      ...deposit,
      amount: "0",
      bridge: null,
      fnName: "proveWithdrawalTransaction",
      hash: "fdc37b".padEnd(64, "2"),
    });
    const withBridge = {
      ...index,
      history: [deposit, proof],
      present: { bridgeContracts: new Set([BRIDGE]) },
    };

    expect(
      searchLocally("40c50a", withBridge).map(({ detail, label, sub }) => [
        label,
        sub,
        detail,
      ])
    ).toEqual([["To DuskEVM", "depositETHToWithValue", "40c50a…111111"]]);
    expect(searchLocally("fdc37b", withBridge)).toEqual([
      expect.objectContaining({
        label: "Withdrawal proved",
        sub: "proveWithdrawalTransaction",
      }),
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
      {
        amount: "1000000000",
        contractId: SOZU_POOL,
        direction: "out",
        fnName: "stake",
        hash: "5d".repeat(32),
        kind: "contract_call",
        source: "archive",
        status: "executed",
      },
      {
        amount: "2000000000",
        counterparty: ALICE,
        direction: "out",
        hash: "e1".repeat(32),
        kind: "transfer",
        memo: "Rent for October",
        source: "archive",
        status: "executed",
      },
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
  it("finds contacts by name, .dusk name or address, and shows a saved person as the contact only", () => {
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
    ]);
    expect(searchLocally(ALICE.slice(4, 14), withContacts)).toEqual([
      expect.objectContaining({ group: "Contacts", label: "Alice" }),
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
