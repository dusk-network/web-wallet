import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contactsWritten,
  deleteContacts,
  listContacts,
  openContacts,
  saveContact,
} from "..";
import {
  contactsNamespace,
  deriveContactsKey,
  sealContacts,
  unsealContacts,
} from "../contactsVault";

const KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-encrypted-contacts`;
const PLAIN_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts`;
const RESET_KEY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-contacts-reset`;
const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const WALLET = {
  account: "first-account-of-a",
  seed: new Uint8Array(64).fill(1),
};

const bob = {
  address: ACCOUNT,
  createdAt: 1,
  id: "bob",
  name: "Bob",
  type: "account",
  updatedAt: 1,
};

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The wallet's key and place, as another tab of it has them. */
const theWallet = async () => ({
  key: await deriveContactsKey(WALLET.seed),
  namespace: await contactsNamespace(WALLET.account),
});

/** The wallet's book as kept, read as another tab would. */
async function keptBook() {
  const { key, namespace } = await theWallet();
  const record = JSON.parse(localStorage.getItem(KEY) ?? "{}")[namespace];

  return record ? JSON.parse(await unsealContacts(key, namespace, record)) : {};
}

/**
 * Another tab keeps a book, encrypted, as it does after a change.
 *
 * @param {Record<string, unknown>} book
 */
async function keepBook(book) {
  const { key, namespace } = await theWallet();
  const record = await sealContacts(key, namespace, JSON.stringify(book));

  localStorage.setItem(KEY, JSON.stringify({ [namespace]: record }));
}

/**
 * Another tab takes the contacts' lock, and keeps it until let go.
 *
 * @returns {Promise<() => Promise<void>>} What lets it go
 */
async function anotherTabsLock() {
  const released = Promise.withResolvers();
  const holding = Promise.withResolvers();
  const done = navigator.locks.request(KEY, async () => {
    holding.resolve(undefined);
    await released.promise;
  });

  await holding.promise;

  return async () => {
    released.resolve(undefined);
    await done;
  };
}

describe("contacts across tabs", () => {
  beforeEach(async () => {
    await openContacts(WALLET);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await contactsWritten();
    await deleteContacts();
    localStorage.clear();
  });

  it("keeps both tabs' changes made at once: neither writes over the other's", async () => {
    const letGo = await anotherTabsLock();
    const read = await keptBook();

    // This tab adds a contact while the other is changing the book.
    saveContact({ address: ACCOUNT, name: "Alice" });
    await sleep(50);
    await keepBook({ ...read, bob });
    await letGo();
    await contactsWritten();

    const names = Object.values(await keptBook()).map((c) => c.name);

    expect(names.sort()).toStrictEqual(["Alice", "Bob"]);
    expect(listContacts().map((c) => c.name)).toStrictEqual(["Alice", "Bob"]);
  });

  it("brings nothing back when another tab resets while a change waits", async () => {
    saveContact({ address: ACCOUNT, name: "Shop" });
    await contactsWritten();

    const letGo = await anotherTabsLock();

    saveContact({ address: ACCOUNT, name: "Alice" });

    // The other tab's Reset.
    localStorage.removeItem(KEY);
    localStorage.removeItem(PLAIN_KEY);
    localStorage.setItem(RESET_KEY, "reset-in-another-tab");
    await letGo();
    await contactsWritten();

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(listContacts()).toStrictEqual([]);
  });

  it("resets after the change another tab is keeping, not before it", async () => {
    const letGo = await anotherTabsLock();
    const reset = deleteContacts();

    await sleep(50);
    await keepBook({ bob });
    await letGo();
    await reset;

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("tries a change again when another tab wrote meanwhile without the lock", async () => {
    const { key, namespace } = await theWallet();
    const others = JSON.stringify({
      [namespace]: await sealContacts(key, namespace, JSON.stringify({ bob })),
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);

    // As this tab seals its change, the other writes its own.
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(
      async (...args) => {
        localStorage.setItem(KEY, others);

        return encrypt(...args);
      }
    );

    saveContact({ address: ACCOUNT, name: "Alice" });
    await contactsWritten();

    const names = Object.values(await keptBook()).map((c) => c.name);

    expect(names.sort()).toStrictEqual(["Alice", "Bob"]);
  });
});
