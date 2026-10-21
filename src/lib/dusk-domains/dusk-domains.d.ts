type DuskNameError =
  | "expired"
  | "invalid"
  | "lookup-failed"
  | "no-address"
  | "not-registered"
  | "unsupported-network";

/**
 * A `.dusk` name lookup: the name, with the public account it
 * resolved to or the reason it can't be paid.
 */
type DuskNameResolution = {
  address?: string;
  error?: DuskNameError;
  name: string;
};
