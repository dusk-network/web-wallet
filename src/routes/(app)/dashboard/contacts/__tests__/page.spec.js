import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { listContacts, removeContact, saveContact } from "$lib/contacts";
import { openTestContacts } from "$lib/test-helpers";

import Contacts from "../+page.svelte";

/** The verified .dusk names of the accounts asked about. */
const names = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<(accounts: string[], where: any) => Promise<Map<string, string | null>>>} */
  of: vi.fn(),
}));

const history = vi.hoisted(() => ({
  /**
   * All of the history, as the page reads it.
   *
   * @type {import("svelte/store").Writable<any> | null}
   */
  whole: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  history.whole = writable({
    failed: false,
    reading: false,
    rows: [],
    whole: true,
  });

  return {
    .../** @type {object} */ (await importOriginal()),
    wholeActivity: history.whole,
  };
});

vi.mock("$lib/activity/counterpartyNames", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  verifiedNamesOf: names.of,
}));

// Testnet accounts: the one shpongle.dusk names, and one without a name.
const NAMED =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const UNNAMED =
  "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";
const SHIELDED =
  "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG";

// The contacts open with a wallet, as when it unlocks.
beforeAll(() => openTestContacts());

describe("Contacts", () => {
  afterEach(() => {
    cleanup();
    names.of.mockReset();
    history.whole?.set({
      failed: false,
      reading: false,
      rows: [],
      whole: true,
    });

    for (const contact of listContacts()) {
      removeContact(contact.id);
    }
  });

  it("gives each contact saved from a public account the .dusk name its account has, whether or not the history shown paid it", async () => {
    names.of.mockResolvedValue(new Map([[NAMED, "shpongle.dusk"]]));
    saveContact({ address: NAMED, name: "Estudio Marta" });
    saveContact({ address: UNNAMED, name: "Lucas" });
    saveContact({ address: SHIELDED, name: "Savings" });
    saveContact({
      address: UNNAMED.replace(/.$/, "x"),
      duskName: "shop.dusk",
      name: "Shop",
    });

    const { container } = render(Contacts);
    const column = (/** @type {string} */ who) =>
      Array.from(container.querySelectorAll(".contacts__row"))
        .find((row) => row.textContent?.includes(who))
        ?.querySelector(".contacts__col-dusk")
        ?.textContent?.trim();

    await vi.waitFor(() =>
      expect(column("Estudio Marta")).toBe("shpongle.dusk")
    );
    expect(column("Lucas")).toBe("—");
    // Only the public accounts saved without a name are asked about.
    expect(names.of).toHaveBeenCalledExactlyOnceWith(
      [NAMED, UNNAMED],
      expect.objectContaining({ nodeUrl: expect.any(String) })
    );
  });

  // Of all of the history: a contact paid two weeks ago, further back than
  // the page History has shown, has its last payment all the same.
  it("gives each contact its last payment from all of the history, not only the page History has shown", async () => {
    names.of.mockResolvedValue(new Map());
    saveContact({ address: UNNAMED, name: "Lucas" });
    history.whole?.set({
      failed: false,
      reading: false,
      rows: [
        rowOf({
          amount: "20000000",
          blockHeight: 4_000_000,
          direction: "out",
          hash: "f4".repeat(32),
          status: "executed",
          timestamp: Date.now() - 14 * 86_400_000,
          to: UNNAMED,
        }),
      ],
      whole: true,
    });

    const { container } = render(Contacts);
    const last = Array.from(container.querySelectorAll(".contacts__row"))
      .find((row) => row.textContent?.includes("Lucas"))
      ?.querySelector(".contacts__col-last");

    expect(last).toHaveTextContent(/^Sent 0\.02 DUSK/);
  });
});
