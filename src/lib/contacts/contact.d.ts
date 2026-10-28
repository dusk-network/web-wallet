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

  type: "account" | "address" | "unknown";

  updatedAt: number;
};
