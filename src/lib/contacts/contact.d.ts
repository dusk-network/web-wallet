/**
 * A contact, in the shape of the extension's address book: a name, the
 * address it sends to, and the `.dusk` name it was saved from with when
 * that name last pointed to the address.
 */
type Contact = {
  /** The public account or shielded address it sends to. */
  address: string;

  /** When `duskName` last pointed to `address`, in milliseconds. */
  checkedAt?: number;

  createdAt: number;

  /** The `.dusk` name it was saved from. */
  duskName?: string;

  id: string;

  /** The contact's name, as the user wrote it. */
  name: string;

  /**
   * Where `duskName` pointed instead when last checked: another address,
   * or "" for none of the contact's kind. Gone once it points back.
   */
  movedTo?: string;

  type: "account" | "address" | "unknown";

  updatedAt: number;
};

/** A wallet's contacts, encrypted: see contactsVault.js. */
type ContactsRecord = {
  /** The encrypted contacts, in base64. */
  data: string;

  /** The write's 12-byte IV, in base64. */
  iv: string;

  v: number;
};
