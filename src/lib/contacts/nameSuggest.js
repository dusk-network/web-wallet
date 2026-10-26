/**
 * "Did you mean alice.dusk?": for a typed `.dusk` name that isn't
 * registered, the closest name this wallet already knows, from its contacts
 * and the other side of past transfers. Nothing is looked up.
 */

/**
 * Edits between two strings: letters added, removed or changed, or two
 * neighbours swapped.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  /** @type {number[][]} */
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);

  for (let j = 1; j <= b.length; j++) {
    rows[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const swapped =
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
          ? rows[i - 2][j - 2] + 1
          : Infinity;

      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
        swapped
      );
    }
  }

  return rows[a.length][b.length];
}

/** @param {string} name */
const label = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/\.dusk$/, "");

/**
 * The known name closest to `typed`: one or two edits away (one for names
 * of four letters or fewer), the first of the closest in `known`'s order.
 *
 * @param {string} typed For example "alcie.dusk"
 * @param {Iterable<string>} known `.dusk` names, the most relevant first
 * @returns {string | null} For example "alice.dusk"
 */
export function closeDuskName(typed, known) {
  const want = label(typed);

  if (!want) {
    return null;
  }

  let best = null;
  let bestEdits = (want.length <= 4 ? 1 : 2) + 1;

  for (const name of known) {
    const have = label(name);

    if (have && have !== want) {
      const edits = editDistance(want, have);

      if (edits < bestEdits) {
        best = have;
        bestEdits = edits;
      }
    }
  }

  return best ? `${best}.dusk` : null;
}
