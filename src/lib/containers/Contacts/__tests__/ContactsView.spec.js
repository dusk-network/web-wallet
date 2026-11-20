import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import {
  contactsStore,
  getContact,
  listContacts,
  markContactNameChecked,
  markContactNameMoved,
  removeContact,
  saveContact,
} from "$lib/contacts";
import { rowOf } from "$lib/activity/__tests__/fixtures/rows";
import { shortenAddress } from "$lib/dusk/string";
import { openTestContacts } from "$lib/test-helpers";

import { shortAddress } from "$lib/activity/present";
import { ContactsView } from "..";
import ContactForm from "../ContactForm.svelte";

const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const OTHER =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const SHIELDED =
  "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG";
const NOW = Date.now();

/** A transfer sent a minute ago. */
const SENT = {
  amount: "40000000000",
  blockHeight: 4_687_600,
  hash: "a1".repeat(32),
  status: "executed",
  timestamp: NOW - 60_000,
  to: ACCOUNT,
};
const rows = [rowOf(SENT)];

const resolveName = vi.fn(async (/** @type {string} */ name) => ({
  account: ACCOUNT,
  name,
}));

/** @param {Partial<import("svelte").ComponentProps<ContactsView>>} [props] */
const show = (props = {}) =>
  render(ContactsView, {
    contacts: get(contactsStore),
    locale: "en",
    resolveName,
    rows,
    ...props,
  });

// The contacts open with a wallet, as when it unlocks.
beforeAll(() => openTestContacts());

describe("ContactsView", () => {
  /** @type {Contact} */
  let shop;

  beforeEach(() => {
    shop = saveContact({
      address: ACCOUNT,
      duskName: "alice-shop.dusk",
      name: "Alice's shop",
    });
    saveContact({ address: SHIELDED, name: "Savings" });
  });

  afterEach(() => {
    cleanup();
    resolveName.mockClear();

    for (const contact of listContacts()) {
      removeContact(contact.id);
    }
  });

  it("links Send to the address saved for the contact", () => {
    const { getByRole } = show();

    expect(getByRole("link", { name: "Send to Alice's shop" })).toHaveAttribute(
      "href",
      `/some-base-path/dashboard/send?to=${ACCOUNT}`,
    );
  });

  it("marks a .dusk name that moved in the table, in place of its tick", async () => {
    markContactNameChecked(shop);

    const { container, rerender } = show({ contacts: get(contactsStore) });
    const dusk = () =>
      container.querySelector(".contacts__row .contacts__col-dusk");

    expect(dusk()?.querySelector(".contacts__checked")).not.toBeNull();

    markContactNameMoved(shop, OTHER);
    await rerender({ contacts: get(contactsStore) });

    expect(dusk()?.querySelector(".contacts__checked")).toBeNull();
    expect(dusk()).toHaveTextContent("alice-shop.dusk");
    expect(dusk()?.querySelector(".contacts__moved")).not.toBeNull();
  });

  it("offers the people paid when there are no contacts yet, never the wallet's own", async () => {
    for (const contact of listContacts()) {
      removeContact(contact.id);
    }

    const own = rowOf({ ...SENT, hash: "a2".repeat(32), to: OTHER });
    const { container, getByRole, queryByText, rerender } = show({
      contacts: [],
      own: [OTHER],
      rows: [...rows, own],
    });
    const people = Array.from(
      container.querySelectorAll(".contacts__person"),
      (item) => item.textContent,
    );

    expect(people).toHaveLength(1);
    expect(people[0]).toContain(shortAddress(ACCOUNT));
    expect(queryByText(`${OTHER.slice(0, 6)}…${OTHER.slice(-6)}`)).toBeNull();

    await fireEvent.click(
      getByRole("button", {
        name: `Save ${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)} to contacts`,
      }),
    );
    // The page opens the new contact's form.
    await rerender({ contacts: [], selected: "new" });

    expect(
      getByRole("textbox", { name: /address or \.dusk name/i }),
    ).toHaveValue(ACCOUNT);
  });

  it("gives a contact saved from an address the .dusk name History names it by, and finds it by that name", async () => {
    // Saved from alice.dusk's address, not its name: History knows the name
    // from a payment that came in from it.
    saveContact({ address: OTHER, name: "Estudio Mаrta" });

    const { container, getByRole } = show({
      contacts: get(contactsStore),
      rows: [
        ...rows,
        rowOf({
          amount: "12000000000",
          blockHeight: 4_687_500,
          counterpartyName: "alice.dusk",
          direction: "in",
          from: OTHER,
          hash: "b2".repeat(32),
          status: "executed",
          timestamp: NOW - 120_000,
        }),
      ],
    });
    const row = () =>
      Array.from(container.querySelectorAll(".contacts__row")).find((each) =>
        each.textContent?.includes("Estudio"),
      );

    expect(row()?.querySelector(".contacts__col-dusk")).toHaveTextContent(
      /^alice\.dusk$/,
    );

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "alice.dusk" },
    });

    expect(
      Array.from(
        container.querySelectorAll(".contacts__name"),
        (name) => name.textContent,
      ),
    ).toEqual(["Estudio Mаrta"]);
  });

  it("gives a contact saved from an address the .dusk name its account has, though the history shown never paid it, and finds it by that name", async () => {
    // Saved from alice.dusk's address; its payments are in another profile's
    // history, or older than what's shown: its name was looked up for it.
    saveContact({ address: OTHER, name: "Estudio Mаrta" });

    const { container, getByRole } = show({
      contacts: get(contactsStore),
      names: new Map([[OTHER, "alice.dusk"]]),
      rows: [],
    });
    const row = () =>
      Array.from(container.querySelectorAll(".contacts__row")).find((each) =>
        each.textContent?.includes("Estudio"),
      );

    expect(row()?.querySelector(".contacts__col-dusk")).toHaveTextContent(
      /^alice\.dusk$/,
    );

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "alice.dusk" },
    });

    expect(
      Array.from(
        container.querySelectorAll(".contacts__name"),
        (name) => name.textContent,
      ),
    ).toEqual(["Estudio Mаrta"]);
  });

  it("marks a contact whose name looks like another's with its address, and finds both by the name", async () => {
    // A Cyrillic а, at another address.
    saveContact({ address: OTHER, name: "Alice's sh\u043Ep" });

    const { container, getByRole } = show({ contacts: get(contactsStore) });
    const marks = () =>
      Array.from(
        container.querySelectorAll(".contacts__alike"),
        (mark) => mark.textContent,
      );

    expect(marks()).toEqual(
      expect.arrayContaining([
        expect.stringContaining(shortAddress(ACCOUNT)),
        expect.stringContaining(shortAddress(OTHER)),
      ]),
    );

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "shop" },
    });

    expect(
      Array.from(
        container.querySelectorAll(".contacts__name"),
        (name) => name.textContent,
      ),
    ).toEqual(["Alice's shop", "Alice's sh\u043Ep"]);
  });

  it("shows a contact's full address and checks that its .dusk name still points there", async () => {
    const { container, getByRole, queryByRole } = show({ selected: shop.id });

    expect(getByRole("heading", { name: "Alice's shop" })).toBeInTheDocument();
    expect(
      container.querySelector(".contact-detail .full-address"),
    ).toHaveTextContent(ACCOUNT);
    // Checked, and still there: nothing to warn of.
    await vi.waitFor(() =>
      expect(
        container.querySelector(".contact-detail__note--checked"),
      ).toHaveTextContent("alice-shop.dusk"),
    );
    expect(queryByRole("alert")).toBeNull();
    expect(resolveName).toHaveBeenCalledExactlyOnceWith("alice-shop.dusk");
    expect(getContact(shop.id)?.checkedAt).toBeGreaterThanOrEqual(
      shop.checkedAt ?? 0,
    );
  });

  it("notes nothing when the network has no names to check a contact's against", async () => {
    resolveName.mockResolvedValueOnce({
      // @ts-ignore: a lookup this network can't run
      error: "unsupported-network",
      name: "alice-shop.dusk",
    });

    const { queryByRole } = show({ selected: shop.id });

    await vi.waitFor(() =>
      expect(resolveName).toHaveBeenCalledWith("alice-shop.dusk"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getContact(shop.id)).not.toHaveProperty("movedTo");
    expect(queryByRole("alert")).toBeNull();
  });

  it("says when a contact's .dusk name points elsewhere, and takes the new address only when asked", async () => {
    resolveName.mockResolvedValueOnce({
      account: OTHER,
      name: "alice-shop.dusk",
    });

    const { findByRole, getByRole, rerender } = show({ selected: shop.id });

    expect(await findByRole("alert")).toHaveTextContent("alice-shop.dusk");
    expect(getContact(shop.id)?.address).toBe(ACCOUNT);

    await fireEvent.click(getByRole("button", { name: "See the new address" }));
    await fireEvent.click(getByRole("button", { name: "Use the new address" }));

    expect(getContact(shop.id)?.address).toBe(OTHER);

    await rerender({ contacts: get(contactsStore) });
  });

  it("keeps a contact's address when the new one its .dusk name points to is another contact's", async () => {
    const bob = saveContact({ address: OTHER, name: "Bob" });

    resolveName.mockResolvedValueOnce({
      account: OTHER,
      name: "alice-shop.dusk",
    });

    const { findByRole, getByRole } = show({
      contacts: get(contactsStore),
      selected: shop.id,
    });

    await findByRole("alert");
    await fireEvent.click(getByRole("button", { name: "See the new address" }));
    await fireEvent.click(getByRole("button", { name: "Use the new address" }));

    expect(getByRole("alert")).toHaveTextContent("Bob");
    expect(getContact(shop.id)?.address).toBe(ACCOUNT);
    expect(getContact(bob.id)?.address).toBe(OTHER);
  });

  it("saves a new contact from a .dusk name, with the address it points to", async () => {
    const select = vi.fn();
    const { findByRole, getByRole } = render(ContactsView, {
      events: { select },
      props: {
        contacts: get(contactsStore),
        locale: "en",
        resolveName,
        rows,
        selected: "new",
      },
    });

    await fireEvent.input(getByRole("textbox", { name: "Name" }), {
      target: { value: "Bram" },
    });
    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "Bram.dusk" } },
    );

    expect(await findByRole("alert")).toHaveTextContent("Alice's shop");
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled(); // The address is already Alice's shop's.

    resolveName.mockResolvedValueOnce({ account: OTHER, name: "bram.dusk" });
    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "bram.dusk" } },
    );
    await act(() => {});
    await fireEvent.click(getByRole("button", { name: "Save contact" }));

    const bram = listContacts("bram")[0];

    expect(bram).toMatchObject({
      address: OTHER,
      duskName: "bram.dusk",
      name: "Bram",
      type: "account",
    });
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { edit: false, id: bram.id } }),
    );
  });

  it("refuses an address that isn't one, and deletes a contact only when asked twice", async () => {
    const savings = listContacts("savings")[0];
    const { getByRole } = show({
      editing: true,
      selected: savings.id,
    });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "not-an-address" } },
    );

    expect(getByRole("alert")).toBeInTheDocument();
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled();

    await fireEvent.click(getByRole("button", { name: "Delete contact" }));

    expect(getContact(savings.id)).not.toBeNull();

    await fireEvent.click(getByRole("button", { name: "Delete Savings" }));

    expect(getContact(savings.id)).toBeNull();
  });

  it("asks at Save about a name in use, or one another contact's starts as, saving it only once answered, and warns of the wallet's own address", async () => {
    const OWN =
      "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6";
    // Addresses no contact here has.
    const NEW =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
    const HIS =
      "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
    const twin = saveContact({ address: OTHER, name: "Estudio Marta" });
    const grandson = saveContact({ address: HIS, name: "Lucas (petit-fils)" });

    try {
      const saved = vi.fn();
      const { getByRole, queryByRole } = render(ContactForm, {
        events: { saved },
        props: { own: [OWN], resolveName },
      });
      const save = () => getByRole("button", { name: "Save contact" });
      /**
       * Asks about the contact it may be, by its name and address.
       *
       * @param {string} who
       * @param {string} address
       */
      const expectAsked = (who, address) => {
        const asked = getByRole("alert");

        expect(asked).toHaveTextContent(who);
        expect(asked).toHaveTextContent(shortenAddress(address));
      };
      /** @param {string} value */
      const name = (value) =>
        fireEvent.input(getByRole("textbox", { name: "Name" }), {
          target: { value },
        });

      await fireEvent.input(
        getByRole("textbox", { name: "Address or .dusk name" }),
        { target: { value: NEW } },
      );

      // Whatever its capitals, spaces and punctuation.
      for (const variant of [
        "estudio marta ",
        " estudio  marta",
        "ESTUDIO MARTA",
        "estudio marta.",
      ]) {
        await name(variant);

        expectAsked("Estudio Marta", OTHER);
      }

      // And in other letters: a Cyrillic а; then Marek's "Davld" and
      // "Dav!d", any thin stroke for an i, as both wallets read them.
      for (const lookalike of [
        "Estudio M\u0430rta",
        "Estud!o Marta",
        "Estudlo Marta",
        "Estud|o Marta",
      ]) {
        await name(lookalike);

        expectAsked("Estudio Marta", OTHER);
      }

      // Amélie's new phone: "Lucas" beside "Lucas (petit-fils)". Asked at
      // Save, and saved only once answered.
      await name("Lucas");

      expectAsked("Lucas (petit-fils)", HIS);
      expect(queryByRole("button", { name: "Yes, save it" })).toBeNull();

      // Typed, Enter, Enter: the question never takes the focus, so the
      // second Enter asks it again, and saves nothing.
      const field = /** @type {HTMLInputElement} */ (
        getByRole("textbox", { name: "Name" })
      );

      field.focus();
      await fireEvent.submit(/** @type {HTMLFormElement} */ (field.form));

      expect(saved).not.toHaveBeenCalled();
      expect(field).toHaveFocus();
      expect(getByRole("button", { name: "Yes, save it" })).not.toHaveFocus();

      await fireEvent.submit(/** @type {HTMLFormElement} */ (field.form));

      expect(saved).not.toHaveBeenCalled();
      expect(getByRole("button", { name: "Yes, save it" })).toBeInTheDocument();

      // Typed again: asked again at Save.
      await name("Lucas ");

      expect(queryByRole("button", { name: "Yes, save it" })).toBeNull();

      await fireEvent.click(save());
      await fireEvent.click(getByRole("button", { name: "Yes, save it" }));

      expect(saved).toHaveBeenCalledOnce();
      expect(
        listContacts().filter(({ name: n }) => /^Lucas/.test(n)),
      ).toHaveLength(2);

      cleanup();

      // Nothing asked: saved at once.
      const other = render(ContactForm, { own: [OWN], resolveName });

      await fireEvent.input(other.getByRole("textbox", { name: "Name" }), {
        target: { value: "Estudio Lena" },
      });

      expect(other.queryByRole("alert")).toBeNull();

      await fireEvent.input(
        other.getByRole("textbox", { name: "Address or .dusk name" }),
        { target: { value: OWN } },
      );

      // Its own warning alone, of no name.
      expect(other.getByRole("alert")).toBeInTheDocument();
      expect(other.getByRole("button", { name: "Save contact" })).toBeEnabled();
    } finally {
      for (const contact of listContacts()) {
        if (/^(Estudio|Lucas)/.test(contact.name)) {
          removeContact(contact.id);
        }
      }

      void twin;
      void grandson;
    }
  });

  it("refuses a profile's name here, as written or in other letters", async () => {
    const { getByRole, queryByRole } = render(ContactForm, {
      profiles: [{ address: SHIELDED, name: "Profile 2" }],
      resolveName,
    });
    /** @param {string} value */
    const name = (value) =>
      fireEvent.input(getByRole("textbox", { name: "Name" }), {
        target: { value },
      });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: OTHER } },
    );
    await name("profile 2");

    expect(getByRole("alert")).toHaveTextContent("Profile 2");
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled();

    // A Cyrillic о.
    await name("Pr\u043efile 2");

    expect(getByRole("alert")).toHaveTextContent("Profile 2");
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled();

    await name("Profile 3");

    expect(queryByRole("alert")).toBeNull();
    expect(getByRole("button", { name: "Save contact" })).toBeEnabled();
  });

  it("asks at Save about a name that starts as a profile's, word for word, saving it only once answered", async () => {
    const saved = vi.fn();
    const { getByRole, queryByRole } = render(ContactForm, {
      events: { saved },
      props: { profiles: [{ address: ACCOUNT, name: "Lucas" }], resolveName },
    });
    /** @param {string} value */
    const name = (value) =>
      fireEvent.input(getByRole("textbox", { name: "Name" }), {
        target: { value },
      });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: OTHER } },
    );
    await name("Lucas (petit-fils)");

    expect(getByRole("alert")).toHaveTextContent("Lucas");

    await fireEvent.click(getByRole("button", { name: "Save contact" }));

    expect(saved).not.toHaveBeenCalled();

    await fireEvent.click(getByRole("button", { name: "Yes, save it" }));

    expect(saved).toHaveBeenCalledOnce();

    for (const contact of listContacts()) {
      if (contact.name === "Lucas (petit-fils)") {
        removeContact(contact.id);
      }
    }

    // Not word for word: nothing asked.
    await name("Lucasta");

    expect(queryByRole("alert")).toBeNull();
  });

  it("refuses a name with what can't be seen in it, which reads as a profile's or a contact's", async () => {
    const alice = saveContact({ address: SHIELDED, name: "Alice" });

    try {
      const { getByRole, queryByRole } = render(ContactForm, {
        profiles: [{ address: ACCOUNT, name: "Profile 2" }],
        resolveName,
      });

      await fireEvent.input(
        getByRole("textbox", { name: "Address or .dusk name" }),
        { target: { value: OTHER } },
      );

      // A right-to-left override reads "2 eliforP" as "Profile 2", and
      // "ecilA" as "Alice"; a zero-width space or a tab shows as nothing.
      for (const hiding of [
        "\u202E2 eliforP",
        "\u202EecilA",
        "Ali\u200Bce",
        "Bob\tSmith",
      ]) {
        await fireEvent.input(getByRole("textbox", { name: "Name" }), {
          target: { value: hiding },
        });

        expect(getByRole("alert")).toBeInTheDocument();
        expect(getByRole("button", { name: "Save contact" })).toBeDisabled();
      }

      await fireEvent.input(getByRole("textbox", { name: "Name" }), {
        target: { value: "Bob Smith" },
      });

      expect(queryByRole("alert")).toBeNull();
      expect(getByRole("button", { name: "Save contact" })).toBeEnabled();
    } finally {
      removeContact(alice.id);
    }
  });

  it("shows a name saved before with what can't be seen in it by its codes, says so, and deletes it", async () => {
    const hiding = saveContact({ address: OTHER, name: "\u202EecilA" });
    const { container, getByRole } = show({
      contacts: get(contactsStore),
      selected: hiding.id,
    });
    const row = /** @type {HTMLElement} */ (
      container.querySelector(`[data-contact="${hiding.id}"]`)
    );

    expect(row).toHaveTextContent("\\u202eecilA");
    expect(row.querySelector(".contacts__hidden")).not.toBeNull();
    expect(row.textContent).not.toContain("\u202E");
    expect(
      getByRole("heading", { name: "\\u202eecilA", level: 2 }),
    ).toBeInTheDocument();
    expect(getByRole("note")).toBeInTheDocument();

    cleanup();

    // It can be deleted.
    const form = show({
      contacts: get(contactsStore),
      editing: true,
      selected: hiding.id,
    });

    await fireEvent.click(form.getByRole("button", { name: "Delete contact" }));
    await fireEvent.click(
      form.getByRole("button", { name: "Delete \\u202eecilA" }),
    );

    expect(getContact(hiding.id)).toBeNull();
  });

  it("won't save a contact named like a .dusk name it isn't saved from", async () => {
    const resolveName = vi.fn().mockResolvedValue({
      account: OTHER,
      name: "alice.dusk",
    });
    const { getByRole, queryAllByRole } = render(ContactForm, { resolveName });
    const save = () => getByRole("button", { name: "Save contact" });
    /** What it says of the name as alice.dusk's, as it can say more. */
    const asAlice = () =>
      queryAllByRole("alert").filter((alert) =>
        alert.textContent?.includes("alice.dusk"),
      );
    /** @param {string} value */
    const name = (value) =>
      fireEvent.input(getByRole("textbox", { name: "Name" }), {
        target: { value },
      });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: OTHER } },
    );

    // In small capitals and after a fullwidth point too: Marek's. And after
    // any point that reads as one: a middle dot, an ideographic full stop,
    // a bullet (Q14), a dot above, a Braille dot, or one with spaces around
    // it (Sofía's and Marek's), each naming the name it looks like.
    for (const value of [
      "alice.dusk",
      "ALICE.Dusk",
      " alice.dusk ",
      "alice.dusk.",
      "alice.ᴅᴜꜱᴋ",
      "alice\uff0edusk",
      "alice·dusk",
      "alice。dusk",
      "alice•dusk",
      "alice˙dusk",
      "alice⠄dusk",
      "alice · dusk",
    ]) {
      await name(value);
      expect(getByRole("alert")).toHaveTextContent("alice.dusk");
      expect(save()).toBeDisabled();
    }

    await name("Alice");
    expect(asAlice()).toHaveLength(0);
    expect(save()).toBeEnabled();

    // Saved from that very name, it's what the contact is.
    await name("alice.dusk");
    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "alice.dusk" } },
    );
    await vi.waitFor(() => expect(save()).toBeEnabled());
    expect(asAlice()).toHaveLength(0);
  });
});
