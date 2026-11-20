import { describe, expect, it } from "vitest";

import { rowOf, rowsOf } from "$lib/activity/__tests__/fixtures/rows";
import { shortAddress } from "$lib/activity/present";

import { lookupKind, lookupName, searchLocally } from "../search";

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
  it("sends to a person History names at the address they paid from, and copies that address", () => {
    const person = searchLocally("alice", index).find(({ id }) =>
      id.startsWith("person:"),
    );

    // Enter sends to a person; Shift+Enter copies the address.
    expect(person).toMatchObject({
      href: `/dashboard/send?to=${ALICE}`,
      label: "alice.dusk",
      value: ALICE,
    });
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
      .filter(({ id }) => id.startsWith("tx:"))
      .map(({ detail, label, value }) => [value?.slice(0, 2), label, detail]);

  it("marks a payment of a contact whose name looks like another's with its address, under it", () => {
    const found = searchLocally("Estudio", {
      ...paid,
      alike: new Set([MARTA]),
    }).filter(({ id }) => id.startsWith("tx:"));

    // As it's found, of no time read yet.
    expect(found.map(({ sub }) => sub)).toEqual([
      expect.stringContaining(shortAddress(MARTA)),
      expect.stringContaining(shortAddress(MARTA)),
    ]);
    expect(
      searchLocally("Estudio", paid).some(({ sub }) =>
        sub?.includes(shortAddress(MARTA)),
      ),
    ).toBe(false);
  });

  it("hides what they moved while balances are hidden", () => {
    const found = paymentsFor("120", { ...paid, hideBalances: true });

    expect(found.map(([hash]) => hash)).toEqual(["a2", "a1"]);

    // Not a figure of it.
    for (const [, , detail] of found) {
      expect(detail).not.toMatch(/\d/);
    }
  });
});

describe("searchLocally with contacts", () => {
  it("finds a contact saved from an address by the .dusk name History names it by, and shows that name", () => {
    // Saved from alice.dusk's address, as a look-alike of another's name.
    const withAddressOnly = {
      ...index,
      contacts: [
        /** @type {Contact} */ ({
          address: ALICE,
          createdAt: 1,
          id: "twin",
          name: "Estudio Mаrta",
          type: "account",
          updatedAt: 1,
        }),
      ],
    };

    expect(searchLocally("alice", withAddressOnly)).toEqual([
      expect.objectContaining({
        detail: "alice.dusk",
        detailIsCode: false,
        id: "contact:twin",
        label: "Estudio Mаrta",
      }),
      expect.objectContaining({
        detail: "+0.5 DUSK",
        id: expect.stringMatching(/^tx:/),
      }),
    ]);
  });
});

describe("searchLocally with contacts whose names look alike", () => {
  it("finds a contact named in letters of another script with the one it looks like, each marked with its address, and the payments of both", () => {
    /** @type {Contact} */
    const marta = {
      address: ALICE,
      createdAt: 1,
      id: "marta",
      name: "Estudio Marta",
      type: "account",
      updatedAt: 1,
    };
    // A Cyrillic а, at the other address.
    const twin = {
      ...marta,
      address: OWN,
      id: "twin",
      name: "Estudio M\u0430rta",
    };
    const found = searchLocally("Marta", {
      ...index,
      alike: new Set([ALICE, OWN]),
      contacts: [marta, twin],
      history: [
        ...index.history,
        rowOf({
          amount: "12000000000",
          direction: "in",
          from: OWN,
          hash: "f7".repeat(32),
          status: "executed",
        }),
      ],
    });

    expect(found.filter(({ id }) => id.startsWith("contact:"))).toEqual([
      expect.objectContaining({
        label: "Estudio Marta",
        sub: expect.stringContaining(shortAddress(ALICE)),
      }),
      expect.objectContaining({
        label: "Estudio M\u0430rta",
        sub: expect.stringContaining(shortAddress(OWN)),
      }),
    ]);
    expect(
      found
        .filter(({ id }) => id.startsWith("tx:"))
        .map(({ detail }) => detail),
    ).toEqual(expect.arrayContaining(["+0.5 DUSK", "+12 DUSK"]));
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
