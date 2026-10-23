type DuskNameError =
  | "expired"
  | "invalid"
  | "lookup-failed"
  | "no-address"
  | "not-registered"
  | "unsupported-network";

/**
 * A `.dusk` name lookup: the name, with the public account and the
 * shielded address it resolved to, or the reason it can't be paid.
 */
type DuskNameResolution = {
  account?: string;
  address?: string;
  error?: DuskNameError;
  name: string;
};
