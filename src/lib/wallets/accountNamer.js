import { derived } from "svelte/store";

import { contactNameText, contactsStore } from "$lib/contacts";
import { shortenAddress } from "$lib/dusk/string";

import walletAccountNames from "./accountNames";

/**
 * What the wallet calls a public account, as it says whom a payment went
 * to: a contact's name, what the wallets here call their profile's account,
 * or else its short address.
 *
 * @type {import("svelte/store").Readable<(account: string) => string>}
 */
const accountNamer = derived(
  [contactsStore, walletAccountNames],
  ([contacts, walletNames]) =>
    (/** @type {string} */ account) => {
      const contact = contacts.find(({ address }) => address === account);

      return contact
        ? contactNameText(contact.name)
        : (walletNames.get(account) ?? shortenAddress(account));
    },
);

export default accountNamer;
