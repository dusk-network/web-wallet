import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import {
  closeContacts,
  contactsStore,
  contactsWritten,
  deleteContacts,
  findContact,
  getContact,
  keepOnlyContactsOf,
  listContacts,
  markContactNameChecked,
  markContactNameMoved,
  openContacts,
  removeContact,
  saveContact,
} from "..";
import {
  contactsNamespace,
  deriveContactsKey,
  sealContacts,
} from "../contactsVault";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-encrypted-contacts`;
const PLAIN_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`;
const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const ADDRESS =
  "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG";

/** Two wallets: their first public accounts and their seeds. */
const WALLET = {
  account: "first-account-of-a",
  seed: new Uint8Array(64).fill(1),
};
const OTHER = {
  account: "first-account-of-b",
  seed: new Uint8Array(64).fill(2),
};

/** Everything the app keeps in localStorage, as one text. */
const everythingKept = () =>
  Object.keys(localStorage)
    .map((key) => `${key}=${localStorage.getItem(key)}`)
    .join("\n");

/** @param {Record<string, unknown>} contacts */
const keepPlain = (contacts) =>
  localStorage.setItem(PLAIN_KEY, JSON.stringify(contacts));

const plainSavings = {
  address: ADDRESS,
  createdAt: 1,
  id: "savings",
  name: "Savings",
  type: "address",
  updatedAt: 1,
};

describe("contacts", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 12));
    await openContacts(WALLET);
  });

  afterEach(async () => {
    await contactsWritten();
    await deleteContacts();
    vi.useRealTimers();
  });

  it("keeps a contact on this device in the extension's shape, with its .dusk name and when it was checked", async () => {
    const shop = saveContact({
      address: ` ${ACCOUNT} `,
      duskName: "Alice-Shop.dusk",
      name: " Alice's shop ",
    });

    expect(shop).toStrictEqual({
      address: ACCOUNT,
      checkedAt: Date.now(),
      createdAt: Date.now(),
      duskName: "alice-shop.dusk",
      id: expect.any(String),
      name: "Alice's shop",
      type: "account",
      updatedAt: Date.now(),
    });

    // Saved from an address alone: no name to check.
    const savings = saveContact({ address: ADDRESS, name: "Savings" });

    expect(savings).not.toHaveProperty("duskName");
    expect(savings).not.toHaveProperty("checkedAt");
    expect(savings.type).toBe("address");

    // Kept as they are, for the next time the wallet opens.
    await contactsWritten();
    closeContacts();

    expect(listContacts()).toStrictEqual([]);

    await openContacts(WALLET);

    expect(listContacts()).toStrictEqual([shop, savings]);
  });

  it("keeps the contacts only encrypted: nothing kept holds a name, a .dusk name or an address", async () => {
    saveContact({
      address: ACCOUNT,
      duskName: "alice-shop.dusk",
      name: "Alice (landlord, private)",
    });
    await contactsWritten();

    const kept = everythingKept();

    expect(kept).toContain(KEY);
    expect(kept).not.toContain("landlord");
    expect(kept).not.toContain("alice-shop");
    expect(kept).not.toContain(ACCOUNT);
    expect(localStorage.getItem(PLAIN_KEY)).toBeNull();

    // One record, at the wallet's place: a version, an IV and the data,
    // which hold no name either once decoded.
    const records = JSON.parse(localStorage.getItem(KEY) ?? "{}");

    expect(Object.keys(records)).toStrictEqual([
      await contactsNamespace(WALLET.account),
    ]);
    expect(Object.values(records)).toStrictEqual([
      { data: expect.any(String), iv: expect.any(String), v: 1 },
    ]);

    const [{ data }] = Object.values(records);

    expect(atob(data)).not.toContain("landlord");
    expect(atob(data)).not.toContain("alice-shop");
  });

  it("encrypts each write with a fresh IV", async () => {
    const shop = saveContact({ address: ACCOUNT, name: "Shop" });

    await contactsWritten();

    const [first] = Object.values(JSON.parse(localStorage.getItem(KEY) ?? ""));

    saveContact({ ...shop });
    await contactsWritten();

    const [second] = Object.values(JSON.parse(localStorage.getItem(KEY) ?? ""));

    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
  });

  it("shows none and changes none while the wallet is locked", async () => {
    saveContact({ address: ACCOUNT, name: "Shop" });
    await contactsWritten();
    closeContacts();

    expect(listContacts()).toStrictEqual([]);
    expect(get(contactsStore)).toStrictEqual([]);
    expect(findContact(ACCOUNT)).toBeNull();
    expect(() => saveContact({ address: ADDRESS, name: "Savings" })).toThrow(
      "unlock it first"
    );
  });

  it("shows another wallet restored in this browser none of them, and keeps them for their own wallet", async () => {
    saveContact({ address: ACCOUNT, name: "Alice (landlord, private)" });
    await contactsWritten();

    await openContacts(OTHER);

    expect(listContacts()).toStrictEqual([]);

    const bob = saveContact({ address: ADDRESS, name: "Bob" });

    await contactsWritten();

    // Each has a record of its own, under its own place.
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY) ?? ""))).toEqual(
      expect.arrayContaining([
        await contactsNamespace(WALLET.account),
        await contactsNamespace(OTHER.account),
      ])
    );

    await openContacts(WALLET);

    expect(listContacts().map((contact) => contact.name)).toStrictEqual([
      "Alice (landlord, private)",
    ]);

    await openContacts(OTHER);

    expect(listContacts()).toStrictEqual([bob]);
  });

  it("fails closed with a wrong key: none show, none change, and the record stays as it is", async () => {
    saveContact({ address: ACCOUNT, name: "Shop" });
    await contactsWritten();

    const kept = localStorage.getItem(KEY);

    // The same place, as only tampering would give it, but another key.
    const opened = await openContacts({
      account: WALLET.account,
      seed: OTHER.seed,
    });

    expect(opened).toBe(false);
    expect(listContacts()).toStrictEqual([]);
    expect(() => saveContact({ address: ADDRESS, name: "Savings" })).toThrow();
    await contactsWritten();
    expect(localStorage.getItem(KEY)).toBe(kept);

    // A record moved to another wallet's place doesn't open either.
    const records = JSON.parse(kept ?? "");
    const moved = {
      [await contactsNamespace(OTHER.account)]:
        records[await contactsNamespace(WALLET.account)],
    };

    localStorage.setItem(KEY, JSON.stringify(moved));

    expect(await openContacts(OTHER)).toBe(false);
    expect(listContacts()).toStrictEqual([]);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(moved));

    // A wallet without a usable seed opens none.
    expect(
      await openContacts({ account: WALLET.account, seed: new Uint8Array() })
    ).toBe(false);
  });

  it("deletes every wallet's contacts on Reset, and those kept in plain text before", async () => {
    saveContact({ address: ACCOUNT, name: "Shop" });
    await openContacts(OTHER);
    saveContact({ address: ADDRESS, name: "Savings" });
    await contactsWritten();
    keepPlain({ savings: plainSavings });

    await deleteContacts();

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(PLAIN_KEY)).toBeNull();
    expect(listContacts()).toStrictEqual([]);

    // Nothing comes back for either wallet.
    await openContacts(WALLET);

    expect(listContacts()).toStrictEqual([]);
  });

  it("doesn't bring contacts back with a write begun before Reset", async () => {
    saveContact({ address: ACCOUNT, name: "Shop" });
    await deleteContacts();
    await contactsWritten();

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("moves the contacts kept in plain text into the wallet's record the first time it opens, and deletes the plain copy", async () => {
    const shop = saveContact({ address: ACCOUNT, name: "Shop" });

    await contactsWritten();
    closeContacts();
    keepPlain({
      broken: { name: 1 },
      savings: plainSavings,
      [shop.id]: { ...shop, name: "Shop, as it was" },
    });

    expect(await openContacts(WALLET)).toBe(true);

    // The wallet's own win.
    expect(listContacts()).toStrictEqual([plainSavings, shop]);
    expect(localStorage.getItem(PLAIN_KEY)).toBeNull();
    expect(everythingKept()).not.toContain("Savings");

    closeContacts();
    await openContacts(WALLET);

    expect(listContacts()).toStrictEqual([plainSavings, shop]);
  });

  it("keeps only the restored wallet's contacts, and those kept in plain text only for the wallet this device had", async () => {
    saveContact({ address: ACCOUNT, name: "Shop" });
    await openContacts(OTHER);
    saveContact({ address: ADDRESS, name: "Bob" });
    await contactsWritten();
    closeContacts();
    keepPlain({ savings: plainSavings });

    // The same wallet again, as after a forgotten password.
    await keepOnlyContactsOf(WALLET.account, { plain: true });

    expect(Object.keys(JSON.parse(localStorage.getItem(KEY) ?? ""))).toEqual([
      await contactsNamespace(WALLET.account),
    ]);
    expect(localStorage.getItem(PLAIN_KEY)).not.toBeNull();

    await openContacts(WALLET);

    expect(listContacts().map((contact) => contact.name)).toStrictEqual([
      "Savings",
      "Shop",
    ]);

    // Another wallet: it starts with none, and the plain ones go.
    closeContacts();
    keepPlain({ savings: plainSavings });
    await keepOnlyContactsOf(OTHER.account, { plain: false });

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(PLAIN_KEY)).toBeNull();

    await openContacts(OTHER);

    expect(listContacts()).toStrictEqual([]);
  });

  it("lists contacts by name, finds them by name, .dusk name or address, and changes one in place", () => {
    const shop = saveContact({
      address: ACCOUNT,
      duskName: "alice-shop.dusk",
      name: "Alice's shop",
    });

    vi.advanceTimersByTime(1000);

    const savings = saveContact({ address: ADDRESS, name: "savings" });

    expect(listContacts().map((c) => c.name)).toStrictEqual([
      "Alice's shop",
      "savings",
    ]);
    expect(listContacts("SHOP")).toStrictEqual([shop]);
    expect(listContacts(ADDRESS.slice(10, 20))).toStrictEqual([savings]);
    expect(get(contactsStore)).toStrictEqual([shop, savings]);

    expect(findContact(ACCOUNT)).toStrictEqual(shop);
    expect(findContact("Alice-Shop.dusk")).toStrictEqual(shop);
    expect(findContact("bob.dusk")).toBeNull();

    vi.advanceTimersByTime(1000);

    const renamed = saveContact({ ...shop, name: "Shop" });

    expect(renamed).toMatchObject({
      createdAt: shop.createdAt,
      id: shop.id,
      name: "Shop",
      updatedAt: Date.now(),
    });
    expect(getContact(shop.id)).toStrictEqual(renamed);
    expect(listContacts()).toHaveLength(2);
  });

  it("notes a name that moved on the contact, until it points back or the contact changes", () => {
    const shop = saveContact({
      address: ACCOUNT,
      duskName: "alice-shop.dusk",
      name: "Alice's shop",
    });

    expect(markContactNameMoved(shop, "elsewhere")).toMatchObject({
      address: ACCOUNT,
      movedTo: "elsewhere",
    });
    expect(markContactNameChecked(shop)).not.toHaveProperty("movedTo");

    markContactNameMoved(shop, "");

    expect(getContact(shop.id)?.movedTo).toBe("");
    expect(
      saveContact({ ...shop, name: "Alice's other shop" })
    ).not.toHaveProperty("movedTo");
    expect(markContactNameMoved(shop, "elsewhere")).toBeNull();
  });

  it("notes a name checked only on the contact as it was checked", () => {
    const shop = saveContact({
      address: ACCOUNT,
      duskName: "alice-shop.dusk",
      name: "Alice's shop",
    });

    vi.advanceTimersByTime(60_000);

    expect(markContactNameChecked(shop)).toMatchObject({
      checkedAt: Date.now(),
    });

    // Changed while it was checked: left as it is.
    const moved = saveContact({ ...shop, address: ADDRESS });

    expect(markContactNameChecked(shop, Date.now() + 1)).toBeNull();
    expect(getContact(shop.id)).toStrictEqual(moved);

    removeContact(shop.id);

    expect(markContactNameChecked(moved)).toBeNull();
    expect(getContact(shop.id)).toBeNull();
  });

  it("follows changes made in another tab, and keeps a change made here meanwhile", async () => {
    const seen = vi.fn();
    const unsubscribe = contactsStore.subscribe(seen);
    const namespace = await contactsNamespace(WALLET.account);
    const record = await sealContacts(
      await deriveContactsKey(WALLET.seed),
      namespace,
      JSON.stringify({ broken: { name: 1 }, savings: plainSavings })
    );

    localStorage.setItem(KEY, JSON.stringify({ [namespace]: record }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    const shop = saveContact({ address: ACCOUNT, name: "Shop" });

    await contactsWritten();

    expect(seen).toHaveBeenLastCalledWith([plainSavings, shop]);

    // A record another tab broke closes them, and stays as it is.
    localStorage.setItem(KEY, JSON.stringify({ [namespace]: { v: 1 } }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    await contactsWritten();

    expect(listContacts()).toStrictEqual([]);
    expect(localStorage.getItem(KEY)).toBe(
      JSON.stringify({ [namespace]: { v: 1 } })
    );

    unsubscribe();
  });

  it("keeps every change on screen while the ones before it are written", async () => {
    /** @type {string[][]} */
    const shown = [];
    const unsubscribe = contactsStore.subscribe((contacts) =>
      shown.push(contacts.map((contact) => contact.name))
    );

    saveContact({ address: ACCOUNT, name: "Shop" });
    saveContact({ address: ADDRESS, name: "Savings" });
    await contactsWritten();
    unsubscribe();

    // Once both are saved, both show, as each is written.
    expect(shown.slice(shown.findIndex((names) => names.length === 2))).toEqual(
      expect.not.arrayContaining([["Shop"]])
    );
    expect(shown.at(-1)).toStrictEqual(["Savings", "Shop"]);
  });

  it("keeps the 200 most recently changed", async () => {
    for (let i = 0; i < 201; i++) {
      vi.setSystemTime(new Date(2026, 9, 26, 12, 0, i));
      saveContact({ address: ADDRESS, id: `c${i}`, name: `Contact ${i}` });
    }

    expect(listContacts()).toHaveLength(200);
    expect(getContact("c0")).toBeNull();

    await contactsWritten();
    closeContacts();
    await openContacts(WALLET);

    expect(listContacts()).toHaveLength(200);
    expect(getContact("c200")).not.toBeNull();
  });
});
