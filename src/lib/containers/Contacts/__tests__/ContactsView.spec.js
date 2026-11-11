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

/** What runs as a navigation ends. */
const navigation = vi.hoisted(() => ({
  /** @type {Array<() => void>} */
  after: [],
}));

vi.mock("$app/navigation", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  afterNavigate: (/** @type {() => void} */ run) => navigation.after.push(run),
}));

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

  it("lists the contacts with their .dusk name, type, address, last payment and a way to send", () => {
    const { container, getByRole, getByText } = show();
    const cells = Array.from(
      container.querySelectorAll(".contacts__row"),
      (row) =>
        Array.from(row.querySelectorAll("td"), (cell) =>
          cell.textContent?.replace(/\s+/g, " ").trim()
        )
    );

    expect(
      getByText("Saved only in this wallet, on this device.")
    ).toBeInTheDocument();
    expect(cells).toEqual([
      [
        "A Alice's shop Sent 40 DUSK · Today",
        "alice-shop.dusk",
        "Public",
        `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)}`,
        "Sent 40 DUSK · Today",
        "Send",
      ],
      [
        `S Savings ${SHIELDED.slice(0, 6)}…${SHIELDED.slice(-6)}`,
        "—",
        "Shielded",
        `${SHIELDED.slice(0, 6)}…${SHIELDED.slice(-6)}`,
        "—",
        "Send",
      ],
    ]);
    expect(getByRole("link", { name: "Send to Alice's shop" })).toHaveAttribute(
      "href",
      `/some-base-path/dashboard/send?to=${ACCOUNT}`
    );
  });

  it("marks a .dusk name that moved in the table, in place of its tick", async () => {
    markContactNameChecked(shop);

    const { container, rerender } = show({ contacts: get(contactsStore) });
    const dusk = () =>
      container.querySelector(".contacts__row .contacts__col-dusk");

    expect(container.querySelector("th.contacts__col-last")).toHaveTextContent(
      "Last activity"
    );
    expect(dusk()?.querySelector(".contacts__checked")).not.toBeNull();

    markContactNameMoved(shop, OTHER);
    await rerender({ contacts: get(contactsStore) });

    expect(dusk()?.querySelector(".contacts__checked")).toBeNull();
    expect(dusk()).toHaveTextContent("alice-shop.dusk moved");
    expect(dusk()?.querySelector(".contacts__moved")).toHaveAttribute(
      "title",
      "Points to another address now"
    );
  });

  it("lists a contact's activity by day, saying what happened rather than who with", async () => {
    const yesterday = new Date(NOW);

    yesterday.setDate(yesterday.getDate() - 1);

    const older = rowOf({
      ...SENT,
      amount: "250000000",
      direction: "in",
      from: ACCOUNT,
      hash: "a3".repeat(32),
      timestamp: yesterday.getTime(),
      to: undefined,
    });
    const { container } = show({
      rows: [...rows, older],
      selected: shop.id,
    });
    const activity = /** @type {HTMLElement} */ (
      container.querySelector(".contact-detail__activity")
    );

    expect(
      Array.from(activity.querySelectorAll(".contact-detail__day"), (day) =>
        day.textContent?.trim()
      )
    ).toStrictEqual(["Today", "Yesterday"]);
    expect(
      Array.from(activity.querySelectorAll(".activity-row__title"), (title) =>
        title.textContent?.trim()
      )
    ).toStrictEqual(["Sent", "Received"]);
    expect(activity).not.toHaveTextContent("Alice's shop ·");
  });

  it("offers the people paid when there are no contacts yet, never the wallet's own", async () => {
    for (const contact of listContacts()) {
      removeContact(contact.id);
    }

    const own = rowOf({ ...SENT, hash: "a2".repeat(32), to: OTHER });
    const { container, getByRole, getByText, queryByText, rerender } = show({
      contacts: [],
      own: [OTHER],
      rows: [...rows, own],
    });

    expect(getByText("Paid before")).toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll(".contacts__person"), (item) =>
        item.textContent?.replace(/\s+/g, " ").trim()
      )
    ).toStrictEqual([
      `${ACCOUNT.slice(0, 1).toUpperCase()} ${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)} Sent 40 DUSK · Today Save`,
    ]);
    expect(queryByText(`${OTHER.slice(0, 6)}…${OTHER.slice(-6)}`)).toBeNull();

    await fireEvent.click(
      getByRole("button", {
        name: `Save ${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)} to contacts`,
      })
    );
    // The page opens the new contact's form.
    await rerender({ contacts: [], selected: "new" });

    expect(
      getByRole("textbox", { name: /address or \.dusk name/i })
    ).toHaveValue(ACCOUNT);
  });

  it("finds contacts by name, .dusk name or address", async () => {
    const { container, getByRole } = show();
    const names = () =>
      Array.from(
        container.querySelectorAll(".contacts__name"),
        (name) => name.textContent
      );

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "shop.dusk" },
    });

    expect(names()).toEqual(["Alice's shop"]);

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: SHIELDED.slice(5, 15) },
    });

    expect(names()).toEqual(["Savings"]);

    // Whatever its accents and case.
    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "ALICE'S SHÖP" },
    });

    expect(names()).toEqual(["Alice's shop"]);
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
        each.textContent?.includes("Estudio")
      );

    expect(row()?.querySelector(".contacts__col-dusk")).toHaveTextContent(
      /^alice\.dusk$/
    );

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "alice.dusk" },
    });

    expect(
      Array.from(
        container.querySelectorAll(".contacts__name"),
        (name) => name.textContent
      )
    ).toEqual(["Estudio Mаrta"]);
  });

  it("marks a contact whose name looks like another's with its address, and finds both by the name", async () => {
    // A Cyrillic а, at another address.
    saveContact({ address: OTHER, name: "Alice's sh\u043Ep" });

    const { container, getByRole } = show({ contacts: get(contactsStore) });
    const marks = () =>
      Array.from(
        container.querySelectorAll(".contacts__alike"),
        (mark) => mark.textContent
      );

    expect(marks()).toEqual(
      expect.arrayContaining([
        `${shortAddress(ACCOUNT)} · name looks like another`,
        `${shortAddress(OTHER)} · name looks like another`,
      ])
    );

    await fireEvent.input(getByRole("searchbox", { name: "Search contacts" }), {
      target: { value: "shop" },
    });

    expect(
      Array.from(
        container.querySelectorAll(".contacts__name"),
        (name) => name.textContent
      )
    ).toEqual(["Alice's shop", "Alice's sh\u043Ep"]);
  });

  it("closes a contact with Escape, wherever the focus is in it, and gives the focus back to its row", async () => {
    const select = vi.fn();
    const { findByRole, getByRole } = render(ContactsView, {
      events: { select },
      props: {
        contacts: get(contactsStore),
        locale: "en",
        resolveName,
        rows,
        selected: shop.id,
      },
    });
    const close = await findByRole("button", { name: "Close the contact" });

    expect(close).toHaveFocus();

    await fireEvent.keyDown(close, { key: "Escape" });

    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.lastCall?.[0].detail).toStrictEqual({
      edit: false,
      id: null,
    });
    expect(getByRole("button", { expanded: true })).toHaveFocus();

    // Going back through the browser's history takes the focus away, as the
    // sheet's step goes: it comes back as that ends.
    getByRole("button", { expanded: true }).blur();
    navigation.after.forEach((run) => run());

    expect(getByRole("button", { expanded: true })).toHaveFocus();
  });

  it("shows a contact's full address and checks that its .dusk name still points there", async () => {
    const { container, findByText, getByRole } = show({ selected: shop.id });

    expect(getByRole("heading", { name: "Alice's shop" })).toBeInTheDocument();
    expect(
      container.querySelector(".contact-detail .full-address")
    ).toHaveTextContent(ACCOUNT);
    expect(
      await findByText(
        /alice-shop\.dusk still points to this address\. Checked just now\./
      )
    ).toBeInTheDocument();
    expect(resolveName).toHaveBeenCalledExactlyOnceWith("alice-shop.dusk");
    expect(getContact(shop.id)?.checkedAt).toBeGreaterThanOrEqual(
      shop.checkedAt ?? 0
    );

    // Its payments, from the history, by what happened.
    expect(
      container.querySelector(".contact-detail__activity .activity-row")
    ).toHaveTextContent(/^Sent .* Public/);
  });

  it("notes nothing when the network has no names to check a contact's against", async () => {
    resolveName.mockResolvedValueOnce({
      // @ts-ignore: a lookup this network can't run
      error: "unsupported-network",
      name: "alice-shop.dusk",
    });

    const { container } = show({ selected: shop.id });

    await vi.waitFor(() =>
      expect(resolveName).toHaveBeenCalledWith("alice-shop.dusk")
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getContact(shop.id)).not.toHaveProperty("movedTo");
    expect(container).not.toHaveTextContent("now points to another address");
  });

  it("says when a contact's .dusk name points elsewhere, and takes the new address only when asked", async () => {
    resolveName.mockResolvedValueOnce({
      account: OTHER,
      name: "alice-shop.dusk",
    });

    const { findByRole, getByRole, rerender } = show({ selected: shop.id });

    expect(await findByRole("alert")).toHaveTextContent(
      "alice-shop.dusk now points to another address. This contact keeps the address saved here, and Send uses it."
    );
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

    const { findByRole, getByRole, getByText } = show({
      contacts: get(contactsStore),
      selected: shop.id,
    });

    await findByRole("alert");
    await fireEvent.click(getByRole("button", { name: "See the new address" }));
    await fireEvent.click(getByRole("button", { name: "Use the new address" }));

    expect(
      getByText("This address is already saved as Bob.")
    ).toBeInTheDocument();
    expect(getContact(shop.id)?.address).toBe(ACCOUNT);
    expect(getContact(bob.id)?.address).toBe(OTHER);
  });

  it("saves a new contact from a .dusk name, with the address it points to", async () => {
    const select = vi.fn();
    const { findByText, getByRole } = render(ContactsView, {
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
      { target: { value: "Bram.dusk" } }
    );

    expect(await findByText(/points to a public account/)).toBeInTheDocument();
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled(); // The address is already Alice's shop's.

    resolveName.mockResolvedValueOnce({ account: OTHER, name: "bram.dusk" });
    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "bram.dusk" } }
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
      expect.objectContaining({ detail: { edit: false, id: bram.id } })
    );
  });

  it("refuses an address that isn't one, and deletes a contact only when asked twice", async () => {
    const savings = listContacts("savings")[0];
    const { getByRole, getByText } = show({
      editing: true,
      selected: savings.id,
    });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "not-an-address" } }
    );

    expect(getByText("Not a valid address.")).toBeInTheDocument();
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled();

    await fireEvent.click(getByRole("button", { name: "Delete contact" }));

    expect(getContact(savings.id)).not.toBeNull();

    await fireEvent.click(getByRole("button", { name: "Delete Savings" }));

    expect(getContact(savings.id)).toBeNull();
  });

  it("warns of a name in use and of the wallet's own address, and saves all the same", async () => {
    const OWN =
      "4ozNeBzeQq5XZGoMYTBKfSG9pmPBa4UWxbfHV3BSDtgeMMz2Xw8oZgVAhN16yC94CUQkg7iAe8fpQT4CsF41iKy6";
    const twin = saveContact({ address: OTHER, name: "Estudio Marta" });

    try {
      const { getByRole, getByText, queryByText } = render(ContactForm, {
        own: [OWN],
        resolveName,
      });
      const save = () => getByRole("button", { name: "Save contact" });
      /** @param {string} value */
      const name = (value) =>
        fireEvent.input(getByRole("textbox", { name: "Name" }), {
          target: { value },
        });

      // Whatever its capitals, spaces and punctuation.
      for (const variant of [
        "estudio marta ",
        " estudio  marta",
        "ESTUDIO MARTA",
        "estudio marta.",
      ]) {
        await name(variant);

        expect(
          getByText(
            `You already have a contact called Estudio Marta, at ${shortenAddress(OTHER)}. Only the address will tell them apart.`
          )
        ).toBeInTheDocument();
      }

      // And in other letters: a Cyrillic а.
      await name("Estudio M\u0430rta");

      expect(
        getByText(
          `That looks like your contact Estudio Marta, at ${shortenAddress(OTHER)}. Only the address will tell them apart.`
        )
      ).toBeInTheDocument();

      await name("Estudio Lena");

      expect(queryByText(/^You already have a contact/)).toBeNull();

      await fireEvent.input(
        getByRole("textbox", { name: "Address or .dusk name" }),
        { target: { value: OWN } }
      );

      expect(getByText("This is your own address.")).toBeInTheDocument();
      expect(save()).toBeEnabled();
    } finally {
      removeContact(twin.id);
    }
  });

  it("refuses a profile's name here, as written or in other letters", async () => {
    const { getByRole, getByText, queryByRole } = render(ContactForm, {
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
      { target: { value: OTHER } }
    );
    await name("profile 2");

    expect(
      getByText(
        "One of your profiles is called Profile 2. Choose another name."
      )
    ).toBeInTheDocument();
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled();

    // A Cyrillic о.
    await name("Pr\u043efile 2");

    expect(
      getByText(
        "That looks like Profile 2, one of your profiles. Choose another name."
      )
    ).toBeInTheDocument();
    expect(getByRole("button", { name: "Save contact" })).toBeDisabled();

    await name("Profile 3");

    expect(queryByRole("alert")).toBeNull();
    expect(getByRole("button", { name: "Save contact" })).toBeEnabled();
  });

  it("asks about a name that starts as a profile's, word for word, saving it all the same", async () => {
    const { getByRole, getByText, queryByText } = render(ContactForm, {
      profiles: [{ address: ACCOUNT, name: "Lucas" }],
      resolveName,
    });
    /** @param {string} value */
    const name = (value) =>
      fireEvent.input(getByRole("textbox", { name: "Name" }), {
        target: { value },
      });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: OTHER } }
    );
    await name("Lucas (petit-fils)");

    expect(
      getByText("One of your profiles is called Lucas. Is this someone else?")
    ).toBeInTheDocument();
    expect(getByRole("button", { name: "Save contact" })).toBeEnabled();

    // Not word for word: nothing asked.
    await name("Lucasta");

    expect(queryByText(/Is this someone else/)).toBeNull();
  });

  it("refuses a name with what can't be seen in it, which reads as a profile's or a contact's", async () => {
    const alice = saveContact({ address: SHIELDED, name: "Alice" });

    try {
      const { getByRole, getByText, queryByRole } = render(ContactForm, {
        profiles: [{ address: ACCOUNT, name: "Profile 2" }],
        resolveName,
      });

      await fireEvent.input(
        getByRole("textbox", { name: "Address or .dusk name" }),
        { target: { value: OTHER } }
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

        expect(
          getByText(
            "This name has hidden characters. Type it again without them."
          )
        ).toBeInTheDocument();
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
    const { container, getByRole, getByText } = show({
      contacts: get(contactsStore),
      selected: hiding.id,
    });
    const row = /** @type {HTMLElement} */ (
      container.querySelector(`[data-contact="${hiding.id}"]`)
    );

    expect(row).toHaveTextContent("\\u202eecilA");
    expect(row).toHaveTextContent("Its name has hidden characters");
    expect(row.textContent).not.toContain("\u202E");
    expect(
      getByRole("heading", { name: "\\u202eecilA", level: 2 })
    ).toBeInTheDocument();
    expect(
      getByText(/^This name has hidden characters, shown here as codes\./)
    ).toBeInTheDocument();

    cleanup();

    // It can be deleted.
    const form = show({
      contacts: get(contactsStore),
      editing: true,
      selected: hiding.id,
    });

    await fireEvent.click(form.getByRole("button", { name: "Delete contact" }));
    await fireEvent.click(
      form.getByRole("button", { name: "Delete \\u202eecilA" })
    );

    expect(getContact(hiding.id)).toBeNull();
  });

  it("doesn't call a contact its own twin as it's edited", async () => {
    const contact = saveContact({ address: OTHER, name: "Estudio Marta" });

    try {
      const { queryByText } = render(ContactForm, { contact, resolveName });

      expect(queryByText(/^You already have a contact/)).toBeNull();
    } finally {
      removeContact(contact.id);
    }
  });

  it("says a name is at the most it can be, once it is", async () => {
    const { getByRole, getByText, queryByText } = render(ContactForm, {
      resolveName,
    });
    const field = getByRole("textbox", { name: "Name" });

    expect(field).toHaveAttribute("maxlength", "40");

    await fireEvent.input(field, { target: { value: "x".repeat(39) } });

    expect(queryByText("40 characters at most.")).toBeNull();

    await fireEvent.input(field, { target: { value: "x".repeat(40) } });

    expect(getByText("40 characters at most.")).toBeInTheDocument();
  });

  it("won't save a contact named like a .dusk name it isn't saved from", async () => {
    const resolveName = vi.fn().mockResolvedValue({
      account: OTHER,
      name: "alice.dusk",
    });
    const { findByText, getByRole, getByText, queryByText } = render(
      ContactForm,
      { resolveName }
    );
    const save = () => getByRole("button", { name: "Save contact" });
    /** @param {string} value */
    const name = (value) =>
      fireEvent.input(getByRole("textbox", { name: "Name" }), {
        target: { value },
      });

    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: OTHER } }
    );

    for (const value of [
      "alice.dusk",
      "ALICE.Dusk",
      " alice.dusk ",
      "alice.dusk.",
    ]) {
      await name(value);
      expect(getByText(/looks like a \.dusk name/)).toBeInTheDocument();
      expect(save()).toBeDisabled();
    }

    await name("Alice");
    expect(queryByText(/looks like a \.dusk name/)).toBeNull();
    expect(save()).toBeEnabled();

    // Saved from that very name, it's what the contact is.
    await name("alice.dusk");
    await fireEvent.input(
      getByRole("textbox", { name: "Address or .dusk name" }),
      { target: { value: "alice.dusk" } }
    );
    await findByText(/points to a public account/);
    expect(queryByText(/looks like a \.dusk name/)).toBeNull();
    expect(save()).toBeEnabled();
  });
});
