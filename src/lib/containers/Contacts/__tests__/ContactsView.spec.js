import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import {
  contactsStore,
  getContact,
  listContacts,
  removeContact,
  saveContact,
} from "$lib/contacts";

import { ContactsView } from "..";

const ACCOUNT =
  "zTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE4FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";
const OTHER =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const SHIELDED =
  "4ZH3oyfTuMHyWD1Rp4e7QKp5yK6wLrWvxHneufAiYBAjvereFvfjtDvTbBcZN5ZCsaoMo49s1LKPTwGpowik6QJG";
const NOW = Date.now();

/** @type {ActivityRow[]} */
const rows = [
  {
    amount: "40000000000",
    blockHeight: 4_687_600,
    direction: "out",
    hash: "a1".repeat(32),
    kind: "transfer",
    privacy: "public",
    source: "archive",
    status: "executed",
    success: true,
    timestamp: NOW - 60_000,
    to: ACCOUNT,
  },
];

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

    expect(getByText("Saved only on this device.")).toBeInTheDocument();
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

    // Its payments, from the history.
    expect(
      container.querySelector(".contact-detail__activity")
    ).toHaveTextContent("Sent");
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
});
