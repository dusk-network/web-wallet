/**
 * A wallet's two profiles, as the wallet shows them: its first, and the
 * one after it, made once. A wallet opened again gets the same two.
 *
 * @param {ProfileGenerator} generator
 * @returns {Promise<[Profile, Profile]>}
 */
export async function profilesOf(generator) {
  const first = await generator.default;
  const made = typeof generator.at === "function" ? generator.at(1) : null;
  const second = await (made ?? generator.next());

  return [first, second];
}
