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

// The `.dusk` names the node gives, by public account, and what the name
// service says of a name looked up, by name: none, as on a network without
// names, unless a test says.
const dusk = vi.hoisted(() => ({ names: new Map(), resolved: new Map() }));

vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getPrimaryName: async (/** @type {string} */ account) =>
    dusk.names.get(account) ?? "",
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

/** The toasts shown, each as it came: they go at once in a test. */
const toasts = /** @type {string[]} */ ([]);
const seen = new Set();

toastList.subscribe((list) => {
  for (const { id, message } of list) {
    if (!seen.has(id)) {
      seen.add(id);
      toasts.push(message);
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
  /** @type {import("@testing-library/svelte").RenderResult<any>} */ settings
) =>
  [1, 2].map(
    (n) =>
      /** @type {HTMLInputElement} */ (
        settings.getByRole("textbox", { name: `Profile ${n} name` })
      ).value
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
          (header) => header.textContent?.replace(/\s+/g, " ").trim()
        ),
      ]);

  return { bar, listed, pill, pillName };
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
    dusk.names.clear();
    dusk.resolved.clear();
    logoutSpy.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("names a profile on this device as its field is left or Enter is pressed, and shows the name in the top bar's pill and the switcher", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const settings = render(Settings);

    expect(
      settings.getByRole("heading", { name: "Names on this device" })
    ).toBeInTheDocument();
    expect(
      settings
        .getByRole("textbox", { name: "Profile 1 name" })
        .getAttribute("placeholder")
    ).toBe("Name, only on this device");

    await nameProfile(settings, 1, "  Savings    jar ");
    await nameProfile(settings, 2, "Spending", "enter");

    expect(toasts).toEqual(["Name saved.", "Name saved."]);
    // One line, as it's kept.
    expect(fieldsOf(settings)).toEqual(["Savings jar", "Spending"]);

    const { listed, pill, pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent("Savings jar");
    // Not a label its number says already: shown on narrow screens too.
    expect(pillName).not.toHaveClass("address-picker__compact-name--label");
    expect(pill).toHaveAccessibleName("Profile: Savings jar");
    expect(listed()).toEqual([
      ["Wallet 1", ["Savings jar (Current)", "Spending"]],
    ]);
  });

  it("shows a verified .dusk name in the pill over the name given here, and both in the switcher", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    dusk.names.set(String(get(walletStore).profiles[0].account), "alice.dusk");

    const settings = render(Settings);

    await nameProfile(settings, 1, "Savings");

    const { bar, listed, pill, pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent("alice.dusk");
    expect(pill).toHaveAccessibleName("Profile: alice.dusk (Savings)");
    expect(listed()).toEqual([
      ["Wallet 1", ["Savings (Current)", "Profile 2"]],
    ]);
    expect(
      bar.container.querySelector(".address-picker__address-name")
    ).toHaveTextContent("alice.dusk");
  });

  it("keeps the name typed last, when it's the one there was, though a save before it waits for the other tabs", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const settings = render(Settings);

    await nameProfile(settings, 1, "Savings");

    // Another tab writes the wallets' names meanwhile: this one's wait.
    const busy = Promise.withResolvers();
    const held = Promise.withResolvers();

    navigator.locks.request(`${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`, () => {
      held.resolve(undefined);

      return busy.promise;
    });
    await held.promise;

    await nameProfile(settings, 1, "Travel", "enter");
    // Back to the name there was, before that save could be.
    await nameProfile(settings, 1, "Savings");

    busy.resolve(undefined);
    await vi.waitFor(() => expect(toasts).toHaveLength(3));
    await settle();

    expect(fieldsOf(settings)).toEqual(["Savings", ""]);

    const { pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent("Savings");
  });

  it("takes a name of 40 characters, says so once the field holds that many, and never saves one cut short", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const NAME = "Savings for Mum in Ipoh, do not touch pl";
    const settings = render(Settings);

    expect(NAME).toHaveLength(40);

    await nameProfile(settings, 1, NAME);

    expect(fieldsOf(settings)).toEqual([NAME, ""]);
    expect(settings.getByText("40 characters at most.")).toBeInTheDocument();
    expect(toasts.at(-1)).toBe("Name saved.");

    // One more, as a script could put there past the field's limit: it
    // stays as typed, unsaved, the limit said.
    toasts.length = 0;
    await nameProfile(settings, 1, `${NAME}s`);

    expect(fieldsOf(settings)).toEqual([`${NAME}s`, ""]);
    expect(settings.getByText("40 characters at most.")).toBeInTheDocument();
    expect(toasts).toEqual([]);

    const { pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent(new RegExp(`^${NAME}$`));
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
    expect(field).toHaveAccessibleDescription(
      "This name has hidden characters. Type it again without them."
    );

    const { pillName } = await openSwitcher();

    expect(pillName).toHaveTextContent("Savings");

    await nameProfile(settings, 1, "Alice");

    expect(toasts).toEqual(["Name saved."]);
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

      for (const [name, words] of [
        [
          "Profile 1",
          "Your other profile is called Profile 1. Choose another name.",
        ],
        [
          "profile 1.",
          "Your other profile is called Profile 1. Choose another name.",
        ],
        ["Alice", "You have a contact called Alice. Choose another name."],
        // A Cyrillic А.
        [
          "\u0410lice",
          "That looks like your contact Alice. Choose another name.",
        ],
      ]) {
        await nameProfile(settings, 2, name, "enter");

        expect(field).toHaveAccessibleDescription(words);
      }

      expect(toasts).toEqual([]);

      // Its own number, and another name, are its to take.
      await nameProfile(settings, 2, "Profile 2");
      await nameProfile(settings, 2, "Savings");

      expect(toasts).toEqual(["Name saved.", "Name saved."]);
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
      "sofiadesign.dusk"
    );

    const settings = render(Settings);
    const field = settings.getByRole("textbox", { name: "Profile 2 name" });

    for (const [name, words] of [
      [
        "sofiadesign.dusk",
        "Your other profile is called sofiadesign.dusk. Choose another name.",
      ],
      // A Cyrillic о.
      [
        "s\u043Efiadesign.dusk",
        "That looks like sofiadesign.dusk, one of your other profiles. Choose another name.",
      ],
    ]) {
      await nameProfile(settings, 2, name, "enter");

      expect(field).toHaveAccessibleDescription(words);
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

      // Asked: nothing saved yet.
      expect(toasts).toEqual([]);
      expect(field).toHaveAccessibleDescription(
        "You have a contact called Lucas (petit-fils). Is this someone else?"
      );
      expect(get(openProfileNames)[0] ?? "").toBe("");

      // Answered: saved as it was typed, and asked no more as it's left.
      await fireEvent.click(
        settings.getByRole("button", { name: "Yes, save it" })
      );
      await vi.waitFor(() => expect(toasts).toEqual(["Name saved."]));

      expect(get(openProfileNames)[0]).toBe("Lucas");

      await fireEvent.blur(field);
      await settle();

      expect(field).not.toHaveAccessibleDescription();
      expect(toasts).toEqual(["Name saved."]);

      // A word of it alone, or another name, asks nothing.
      await nameProfile(settings, 1, "Luc");

      expect(field).not.toHaveAccessibleDescription();
      expect(toasts).toEqual(["Name saved.", "Name saved."]);
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
      "sofiadesign.dusk"
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

      for (const [name, words] of [
        [
          "alice.dusk",
          "You have a contact called Wendy, at alice.dusk. Is this someone else?",
        ],
        [
          "sofiadesign.dusk cliente",
          "Your other profile is called sofiadesign.dusk. Is this someone else?",
        ],
        [
          "sofiadesign",
          "Your other profile is called sofiadesign.dusk. Is this someone else?",
        ],
        // Someone paid, not a contact: Marek's "sofiadesign.dusk" in another's place.
        [
          "Mi cliente (marek.dusk)",
          "marek.dusk is a .dusk name. Is it this profile's?",
        ],
      ]) {
        await nameProfile(settings, 2, name, "enter");

        expect(field).toHaveAccessibleDescription(words);
        expect(fieldsOf(settings)[1]).toBe(name);
      }

      // Nothing saved while asked.
      expect(toasts).toEqual([]);
      expect(get(openProfileNames)[1] ?? "").toBe("");

      // Yes saves the name asked about.
      await fireEvent.click(
        settings.getByRole("button", { name: "Yes, save it" })
      );
      await vi.waitFor(() => expect(toasts).toEqual(["Name saved."]));

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

    for (const name of ["sofiadesign.dusk", "Mi cliente (sofiadesign.dusk)"]) {
      await nameProfile(settings, 2, name, "enter");

      await vi.waitFor(() =>
        expect(field).toHaveAccessibleDescription(
          "sofiadesign.dusk belongs to another account. Choose another name."
        )
      );
      expect(
        settings.queryByRole("button", { name: "Yes, save it" })
      ).toBeNull();
    }

    expect(toasts).toEqual([]);
    expect(get(openProfileNames)[1] ?? "").toBe("");

    // Its own: saved, with nothing to ask.
    await nameProfile(settings, 2, "marek.dusk", "enter");
    await vi.waitFor(() => expect(toasts).toEqual(["Name saved."]));

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

      for (const [name, words] of [
        ["VVendy", "That looks like your contact Wendy. Choose another name."],
        ["Davicl", "That looks like your contact David. Choose another name."],
        // A digit for a letter, and v for y.
        ["Dav1d", "That looks like your contact David. Choose another name."],
        ["Wendv", "That looks like your contact Wendy. Choose another name."],
      ]) {
        await nameProfile(settings, 2, name, "enter");

        expect(field).toHaveAccessibleDescription(words);
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
      ["Wallet 2", ["Profile 1 (Current)", "Travel"]],
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
      ["Wallet 2", ["Profile 1 (Current)", "Profile 2"]],
    ]);
  });

  it("forgets every name on Reset", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true)
    );
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    let settings = render(Settings);

    await nameProfile(settings, 1, "Savings");
    await fireEvent.click(
      settings.getByRole("button", { name: "Reset Wallet" })
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
    expect(pillName).toHaveClass("address-picker__compact-name--label");
  });
});
