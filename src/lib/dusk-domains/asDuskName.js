/** A label of a `.dusk` name: 1 to 63 lowercase letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The `.dusk` name a name typed without its ending, or with a dot after
 * it, likely means: "alice" or "alice.dusk." for alice.dusk. Nothing is
 * looked up. Null for anything else, as an address: one with a capital
 * after its first letter, or an EVM address.
 *
 * @param {string} input
 * @returns {string | null} For example "alice.dusk"
 */
export default function asDuskName(input) {
  const typed = input.trim().replace(/\.+$/, "");

  if (!typed || /[A-Z]/.test(typed.slice(1)) || /^0x[0-9a-f]*$/i.test(typed)) {
    return null;
  }

  const labels = typed.toLowerCase().split(".");
  const named = labels.at(-1) === "dusk" ? labels.slice(0, -1) : labels;

  return named.length > 0 &&
    named.length <= 4 &&
    named.every((label) => LABEL.test(label))
    ? `${named.join(".")}.dusk`
    : null;
}
