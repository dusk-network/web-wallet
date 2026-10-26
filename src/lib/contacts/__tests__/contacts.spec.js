import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import {
  contactsStore,
  findContact,
  getContact,
  listContacts,
  markContactNameChecked,
  removeContact,
  saveContact,
} from "..";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`;
const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const ADDRESS =
  "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG";

describe("contacts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 12));
  });

  afterEach(() => {
    for (const contact of listContacts()) {
      removeContact(contact.id);
    }

    localStorage.removeItem(KEY);
    vi.useRealTimers();
  });

  it("keeps a contact on this device in the extension's shape, with its .dusk name and when it was checked", () => {
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
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toStrictEqual({
      [shop.id]: shop,
    });

    // Saved from an address alone: no name to check.
    const savings = saveContact({ address: ADDRESS, name: "Savings" });

    expect(savings).not.toHaveProperty("duskName");
    expect(savings).not.toHaveProperty("checkedAt");
    expect(savings.type).toBe("address");
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

  it("follows changes made in another tab, and reads nothing it doesn't know", () => {
    const savings = {
      address: ADDRESS,
      createdAt: 1,
      id: "savings",
      name: "Savings",
      type: "address",
      updatedAt: 1,
    };
    const seen = vi.fn();
    const unsubscribe = contactsStore.subscribe(seen);

    localStorage.setItem(KEY, JSON.stringify({ broken: { name: 1 }, savings }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));

    expect(seen).toHaveBeenLastCalledWith([savings]);

    localStorage.setItem(KEY, "{not json");

    expect(listContacts()).toStrictEqual([]);

    unsubscribe();
  });
});
