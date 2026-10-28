import { describe, expect, it } from "vitest";

import {
  CONTACTS_INFO,
  contactsNamespace,
  deriveContactsKey,
  sealContacts,
  unsealContacts,
} from "../contactsVault";

const SEED = new Uint8Array(64).fill(1);
const OTHER_SEED = new Uint8Array(64).fill(2);

describe("contactsVault", () => {
  it("makes an AES-GCM-256 key from the wallet's seed that can't be exported, and needs a seed", async () => {
    const key = await deriveContactsKey(SEED);

    expect(CONTACTS_INFO).toBe("dusk-wallet/contacts/v1");
    expect(key.algorithm).toStrictEqual({ length: 256, name: "AES-GCM" });
    expect(key.extractable).toBe(false);
    expect(key.usages.sort()).toStrictEqual(["decrypt", "encrypt"]);
    await expect(deriveContactsKey(new Uint8Array())).rejects.toThrow();
    await expect(
      deriveContactsKey(/** @type {any} */ ("seed"))
    ).rejects.toThrow();
  });

  it("makes the same key from the same seed", async () => {
    const record = await sealContacts(
      await deriveContactsKey(SEED),
      "place",
      "{}"
    );

    await expect(
      unsealContacts(await deriveContactsKey(SEED), "place", record)
    ).resolves.toBe("{}");
  });

  it("names each wallet's place by a hash of its first public account", async () => {
    const place = await contactsNamespace("account-a");

    expect(place).toMatch(/^[0-9a-f]{64}$/);
    expect(await contactsNamespace("account-a")).toBe(place);
    expect(await contactsNamespace("account-b")).not.toBe(place);
    await expect(contactsNamespace("")).rejects.toThrow();
  });

  it("opens a record only with its key, at its place, as it was written", async () => {
    const key = await deriveContactsKey(SEED);
    const record = await sealContacts(key, "place-a", '{"a":"Alice"}');

    expect(record).toStrictEqual({
      data: expect.any(String),
      iv: expect.any(String),
      v: 1,
    });
    expect(atob(record.iv)).toHaveLength(12);
    expect(atob(record.data)).not.toContain("Alice");
    await expect(unsealContacts(key, "place-a", record)).resolves.toBe(
      '{"a":"Alice"}'
    );

    // Another key, another place, or changed data: it doesn't open.
    await expect(
      unsealContacts(await deriveContactsKey(OTHER_SEED), "place-a", record)
    ).rejects.toThrow();
    await expect(unsealContacts(key, "place-b", record)).rejects.toThrow();

    const bytes = Uint8Array.from(atob(record.data), (c) => c.charCodeAt(0));

    bytes[0] ^= 1;
    await expect(
      unsealContacts(key, "place-a", {
        ...record,
        data: btoa(String.fromCharCode(...bytes)),
      })
    ).rejects.toThrow();
  });

  it("takes a fresh IV for each write", async () => {
    const key = await deriveContactsKey(SEED);
    const first = await sealContacts(key, "place", "{}");
    const second = await sealContacts(key, "place", "{}");

    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
  });

  it("refuses a record of another shape", async () => {
    const key = await deriveContactsKey(SEED);
    const record = await sealContacts(key, "place", "{}");

    for (const broken of [
      null,
      "text",
      { ...record, v: 2 },
      { ...record, iv: 1 },
      { ...record, iv: btoa("short") },
      { iv: record.iv, v: 1 },
    ]) {
      await expect(unsealContacts(key, "place", broken)).rejects.toThrow();
    }
  });
});
