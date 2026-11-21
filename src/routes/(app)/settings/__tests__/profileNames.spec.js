import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { get } from "svelte/store";

import { toastList } from "$lib/dusk/components/Toast/store";
import TopBar from "$lib/containers/Shell/TopBar.svelte";
import { shellTabs } from "$lib/containers/Shell/navigation";
import * as navigation from "$lib/navigation";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import {
  addWallet,
  openProfileNames,
  removeWallet,
  switchToWallet,
  unlockWallets,
} from "$lib/wallets";

import Settings from "../+page.svelte";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

// No `.dusk` name the node gives any account, and what the name service says
// of a name looked up, by name: none, as on a network without names, unless
// a test says.
const dusk = vi.hoisted(() => ({ resolved: new Map() }));

vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getPrimaryName: async () => "",
}));

vi.mock("$lib/dusk-domains/resolveDuskName", () => ({
  default: async (/** @type {string} */ name) =>
    dusk.resolved.get(name) ?? { error: "unsupported-network", name },
}));

const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

/** Lets the stores and the lookups settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * The toasts shown, by type ("success" for a name saved), each as it came:
 * they go at once in a test.
 */
const toasts = /** @type {string[]} */ ([]);
const seen = new Set();

toastList.subscribe((list) => {
  for (const { id, type } of list) {
    if (!seen.has(id)) {
      seen.add(id);
      toasts.push(type);
    }
  }
});

/**
 * Types a profile's name in Settings, and leaves the field, or presses
 * Enter in it.
 *
 * @param {import("@testing-library/svelte").RenderResult<any>} settings
 * @param {number} n The profile's number
 * @param {string} name
 * @param {"blur" | "enter"} [how]
 */
async function nameProfile(settings, n, name, how = "blur") {
  const field = settings.getByRole("textbox", { name: `Profile ${n} name` });

  await fireEvent.input(field, { target: { value: name } });

  if (how === "enter") {
    await fireEvent.keyDown(field, { key: "Enter" });
  } else {
    await fireEvent.blur(field);
  }

  await settle();
}

/** The names the fields in Settings show, by profile. */
const fieldsOf = (
  /** @type {import("@testing-library/svelte").RenderResult<any>} */ settings,
) =>
  [1, 2].map(
    (n) =>
      /** @type {HTMLInputElement} */ (
        settings.getByRole("textbox", { name: `Profile ${n} name` })
      ).value,
  );

/** The top bar, with the profile switcher open. */
async function openSwitcher() {
  const bar = render(TopBar, {
    activeTab: "home",
    tabs: shellTabs({ stake: true }),
  });

  await settle();

  const pill = /** @type {HTMLElement} */ (
    bar.container.querySelector(".address-picker__trigger")
  );
  const pillName = pill.querySelector(".address-picker__compact-name");

  await fireEvent.click(pill);

  const menu = bar.getByRole("menu", { name: "Profile selection" });

  /** Each wallet's profiles' headers, under its name. */
  const listed = () =>
    within(menu)
      .getAllByRole("group")
      .map((group) => [
        document.getElementById(group.getAttribute("aria-labelledby") ?? "")
          ?.textContent,
        Array.from(
          group.querySelectorAll(".address-picker__profile-header"),
          (header) => header.textContent?.replace(/\s+/g, " ").trim(),
        ),
      ]);

  return { listed, pillName };
}

describe("Settings › Profiles", () => {
  const logoutSpy = vi
    .spyOn(navigation, "logout")
    .mockImplementation(async () => walletStore.reset());

  stubWalletNetwork();

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    await vault.clear();
    localStorage.clear();
    toasts.length = 0;
    dusk.resolved.clear();
    logoutSpy.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refuses a name with what can't be seen in it, saying so under its field, until it's typed again", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const settings = render(Settings);

    await nameProfile(settings, 1, "Savings");
    toasts.length = 0;

    // A right-to-left override makes "ecilA" read as "Alice".
    await nameProfile(settings, 1, "\u202EecilA", "enter");

    const field = settings.getByRole("textbox", { name: "Profile 1 name" });

    expect(toasts).toEqual([]);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/\S/);

    const { pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent("Savings");

    await nameProfile(settings, 1, "Alice");

    expect(toasts).toEqual(["success"]);
    expect(field).not.toHaveAccessibleDescription();
  });

  it("refuses a profile name that is, or looks like, the other profile's or a contact's, saying whose", async () => {
    const { openTestContacts } = await import("$lib/test-helpers");
    const { removeContact, saveContact } = await import("$lib/contacts");

    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    await openTestContacts();

    const alice = saveContact({
      address:
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi",
      name: "Alice",
    });

    try {
      const settings = render(Settings);
      const field = settings.getByRole("textbox", { name: "Profile 2 name" });

      for (const [name, whose] of [
        ["Profile 1", "Profile 1"],
        ["profile 1.", "Profile 1"],
        ["Alice", "Alice"],
        // A Cyrillic А.
        ["\u0410lice", "Alice"],
      ]) {
        await nameProfile(settings, 2, name, "enter");

        // Refused, naming whose it is.
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(field).toHaveAccessibleDescription(
          expect.stringContaining(whose),
        );
      }

      expect(toasts).toEqual([]);

      // Its own number, and another name, are its to take.
      await nameProfile(settings, 2, "Profile 2");
      await nameProfile(settings, 2, "Savings");

      expect(toasts).toEqual(["success", "success"]);
      expect(field).not.toHaveAccessibleDescription();
    } finally {
      removeContact(alice.id);
    }
  });

  it("refuses a profile name that is, or looks like, another profile's .dusk name, saying which", async () => {
    const { keepVerifiedName } =
      await import("$lib/dusk-domains/verifiedNames");
    const { networkStore } = await import("$lib/stores");

    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    keepVerifiedName(
      get(networkStore).networkName,
      String(get(walletStore).profiles[0].account),
      "sofiadesign.dusk",
    );

    const settings = render(Settings);
    const field = settings.getByRole("textbox", { name: "Profile 2 name" });

    for (const [name, whose] of [
      ["sofiadesign.dusk", "sofiadesign.dusk"],
      // A Cyrillic о.
      ["s\u043Efiadesign.dusk", "sofiadesign.dusk"],
    ]) {
      await nameProfile(settings, 2, name, "enter");

      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveAccessibleDescription(expect.stringContaining(whose));
    }

    expect(toasts).toEqual([]);
  });

  it("asks about a profile name a contact's starts as, word for word, and saves it only once answered", async () => {
    const { openTestContacts } = await import("$lib/test-helpers");
    const { removeContact, saveContact } = await import("$lib/contacts");

    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    await openTestContacts();

    const lucas = saveContact({
      address:
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi",
      name: "Lucas (petit-fils)",
    });

    try {
      const settings = render(Settings);
      const field = settings.getByRole("textbox", { name: "Profile 1 name" });

      await nameProfile(settings, 1, "Lucas");

      // Asked, naming the contact: nothing saved yet.
      expect(toasts).toEqual([]);
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining("Lucas (petit-fils)"),
      );
      expect(get(openProfileNames)[0] ?? "").toBe("");

      // Answered: saved as it was typed, and asked no more as it's left.
      await fireEvent.click(
        settings.getByRole("button", { name: "Yes, save it" }),
      );
      await vi.waitFor(() => expect(toasts).toEqual(["success"]));

      expect(get(openProfileNames)[0]).toBe("Lucas");

      await fireEvent.blur(field);
      await settle();

      expect(field).not.toHaveAccessibleDescription();
      expect(toasts).toEqual(["success"]);

      // A word of it alone, or another name, asks nothing.
      await nameProfile(settings, 1, "Luc");

      expect(field).not.toHaveAccessibleDescription();
      expect(toasts).toEqual(["success", "success"]);
    } finally {
      removeContact(lucas.id);
    }
  });

  it("asks about a profile name with any .dusk name in it, a contact's, the other profile's or a stranger's, naming whose where it can, and saves it only once answered", async () => {
    const { openTestContacts } = await import("$lib/test-helpers");
    const { removeContact, saveContact } = await import("$lib/contacts");
    const { keepVerifiedName } =
      await import("$lib/dusk-domains/verifiedNames");
    const { networkStore } = await import("$lib/stores");

    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    await openTestContacts();
    keepVerifiedName(
      get(networkStore).networkName,
      String(get(walletStore).profiles[0].account),
      "sofiadesign.dusk",
    );

    // Wendy, saved from alice.dusk; and someone called Alice.
    const wendy = saveContact({
      address:
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi",
      duskName: "alice.dusk",
      name: "Wendy",
    });
    const alice = saveContact({
      address:
        "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um",
      name: "Alice",
    });

    try {
      const settings = render(Settings);
      const field = settings.getByRole("textbox", { name: "Profile 2 name" });

      for (const [name, ...named] of [
        ["alice.dusk", "Wendy", "alice.dusk"],
        ["sofiadesign.dusk cliente", "sofiadesign.dusk"],
        ["sofiadesign", "sofiadesign.dusk"],
        // Someone paid, not a contact: Marek's "sofiadesign.dusk" in another's place.
        ["Mi cliente (marek.dusk)", "marek.dusk"],
      ]) {
        await nameProfile(settings, 2, name, "enter");

        // Asked, naming whose it is where it can, with Yes to save it.
        for (const whose of named) {
          expect(field).toHaveAccessibleDescription(
            expect.stringContaining(whose),
          );
        }

        expect(
          settings.getByRole("button", { name: "Yes, save it" }),
        ).toBeInTheDocument();
        expect(fieldsOf(settings)[1]).toBe(name);
      }

      // Nothing saved while asked.
      expect(toasts).toEqual([]);
      expect(get(openProfileNames)[1] ?? "").toBe("");

      // Yes saves the name asked about.
      await fireEvent.click(
        settings.getByRole("button", { name: "Yes, save it" }),
      );
      await vi.waitFor(() => expect(toasts).toEqual(["success"]));

      expect(get(openProfileNames)[1]).toBe("Mi cliente (marek.dusk)");
    } finally {
      removeContact(wendy.id);
      removeContact(alice.id);
    }
  });

  it("refuses a profile name with a .dusk name another account has, as the name service says, and takes this profile's own with no question", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const own = String(get(walletStore).profiles[1].account);

    // Sofía's, registered to her account; and Profile 2's own.
    dusk.resolved.set("sofiadesign.dusk", {
      account:
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi",
      name: "sofiadesign.dusk",
    });
    dusk.resolved.set("marek.dusk", { account: own, name: "marek.dusk" });

    const settings = render(Settings);
    const field = settings.getByRole("textbox", { name: "Profile 2 name" });

    // In small capitals and circled letters too: Marek's, which History
    // then gave his own transfers.
    for (const [name, whose] of [
      ["sofiadesign.dusk", "sofiadesign.dusk"],
      ["Mi cliente (sofiadesign.dusk)", "sofiadesign.dusk"],
      ["sofiadesign.ᴅᴜꜱᴋ", "sofiadesign.dusk"],
      ["ⓢⓞⓕⓘⓐⓓⓔⓢⓘⓖⓝ.dusk", "sofiadesign.dusk"],
      // Q14, Marek's: a middle dot, an ideographic full stop or a bullet for
      // the point saved without a word, and History filed his own
      // transfers under it, right above Sofía's. Then a dot above, a Braille
      // dot, and a middle dot with a space after it.
      ...[
        "sofiadesign·dusk",
        "sofiadesign。dusk",
        "sofiadesign•dusk",
        "sofiadesign˙dusk",
        "sofiadesign⠄dusk",
        "sofiadesign· dusk",
      ].map((styled) => [styled, "sofiadesign.dusk"]),
    ]) {
      await nameProfile(settings, 2, name, "enter");

      await vi.waitFor(() =>
        expect(field).toHaveAccessibleDescription(
          expect.stringContaining(whose),
        ),
      );
      expect(
        settings.queryByRole("button", { name: "Yes, save it" }),
      ).toBeNull();
    }

    expect(toasts).toEqual([]);
    expect(get(openProfileNames)[1] ?? "").toBe("");

    // Its own: saved, with nothing to ask.
    await nameProfile(settings, 2, "marek.dusk", "enter");
    await vi.waitFor(() => expect(toasts).toEqual(["success"]));

    expect(get(openProfileNames)[1]).toBe("marek.dusk");
  });

  it("refuses a profile name that reads as a contact's with letters in pairs or a digit for a letter, as VVendy for Wendy and Dav1d for David", async () => {
    const { openTestContacts } = await import("$lib/test-helpers");
    const { removeContact, saveContact } = await import("$lib/contacts");

    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    await openTestContacts();

    const wendy = saveContact({
      address:
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi",
      name: "Wendy",
    });
    const david = saveContact({
      address:
        "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um",
      name: "David",
    });

    try {
      const settings = render(Settings);
      const field = settings.getByRole("textbox", { name: "Profile 2 name" });

      for (const [name, whose] of [
        ["VVendy", "Wendy"],
        ["Davicl", "David"],
        // A digit for a letter, and v for y.
        ["Dav1d", "David"],
        ["Wendv", "Wendy"],
        // Marek's: l and ! for an i.
        ["Davld", "David"],
        ["Dav!d", "David"],
      ]) {
        await nameProfile(settings, 2, name, "enter");

        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(field).toHaveAccessibleDescription(
          expect.stringContaining(whose),
        );
      }

      expect(toasts).toEqual([]);
    } finally {
      removeContact(wendy.id);
      removeContact(david.id);
    }
  });

  it("keeps each wallet's names its own, and forgets a removed wallet's", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const [first] = vault.list() ?? [];
    let settings = render(Settings);

    await nameProfile(settings, 1, "Savings");
    cleanup();

    const second = await addWallet(B, PASSWORD);

    settings = render(Settings);

    // The wallet added has names of its own: none yet.
    expect(fieldsOf(settings)).toEqual(["", ""]);

    await nameProfile(settings, 2, "Travel");

    let switcher = await openSwitcher();

    expect(switcher.pillName).toHaveTextContent("Profile 1");
    expect(switcher.listed()).toEqual([
      ["Wallet 1", ["Savings", "Profile 2"]],
      ["Wallet 2", [expect.stringMatching(/^Profile 1\b/), "Travel"]],
    ]);
    cleanup();

    await switchToWallet(first.id);
    settings = render(Settings);

    expect(fieldsOf(settings)).toEqual(["Savings", ""]);
    cleanup();

    // Removed, then added again: nothing of its names is left.
    await removeWallet(second.id, PASSWORD);
    await addWallet(B, PASSWORD);
    settings = render(Settings);

    expect(fieldsOf(settings)).toEqual(["", ""]);

    switcher = await openSwitcher();

    expect(switcher.listed()).toEqual([
      ["Wallet 1", ["Savings", "Profile 2"]],
      ["Wallet 2", [expect.stringMatching(/^Profile 1\b/), "Profile 2"]],
    ]);
  });

  it("forgets every name on Reset", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    let settings = render(Settings);

    await nameProfile(settings, 1, "Savings");
    await fireEvent.click(
      settings.getByRole("button", { name: "Reset wallet" }),
    );
    await vi.waitFor(() => expect(logoutSpy).toHaveBeenCalled());
    cleanup();

    // The same phrase, set up again.
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    settings = render(Settings);

    expect(fieldsOf(settings)).toEqual(["", ""]);

    const { pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent("Profile 1");
  });
});
