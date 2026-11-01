/**
 * A stand-in for the protocol driver's profiles where each wallet's, and
 * each of its profiles', accounts and addresses must differ: bytes from the
 * seed and the profile's index. The driver's own stand-in gives every one
 * the same.
 *
 * @param {Uint8Array} seed
 * @param {number} n
 * @returns {Promise<Uint8Array>}
 */
export default async function distinctProfile(seed, n) {
  let h = n + 1;

  for (const byte of seed) {
    h = (Math.imul(h, 31) + byte) >>> 0;
  }

  return Uint8Array.from({ length: 64 + 96 }, (_, i) => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ i) >>> 0;

    return h & 0xff;
  });
}
