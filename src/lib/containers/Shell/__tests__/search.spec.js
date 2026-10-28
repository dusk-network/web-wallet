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
        detail: "alice.dusk",
        group: "Transactions",
        href: `/dashboard/transactions?tx=${"dc3f73".padEnd(64, "0")}`,
      }),
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
