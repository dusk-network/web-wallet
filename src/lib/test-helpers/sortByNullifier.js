/**
 * We need to sort the entries in tests as the
 * database doesn't guarantee a sort order.
 *
 * @typedef {{ nullifier: Uint8Array<ArrayBuffer> }} T
 * @type {<U extends T>(entries: U[]) => U[]}
 */
const sortByNullifier = (entries) =>
  entries.toSorted((a, b) =>
    a.nullifier.toString().localeCompare(b.nullifier.toString())
  );

export default sortByNullifier;
