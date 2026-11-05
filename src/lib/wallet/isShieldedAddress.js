import { decodeBase58 } from "@dusk-network/networks/account";

/**
 * Whether a text is a shielded address that can receive: the base58 of two
 * public keys, each a point of the JubJub curve, compressed, of the group that
 * keys are made in, and not its neutral point. It's checked as a public account
 * is (`isAccount`), so DUSK isn't sent to one that could never spend it. Neither
 * w3sper nor the wallet core has a check of it, so it's here, in plain integers.
 */

/** The field JubJub is over: BLS12-381's scalars. */
const Q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

/** The curve is -u² + v² = 1 + d·u²·v². */
const D = 0x2a9318e74bfa2b48f5fd9207e6bd7fd4292d7f6d37579d2601065fd6d6343eb1n;

/** The order of the group keys are made in. */
const ORDER =
  0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

/** Q - 1 is 2³² times this. */
const ODD = (Q - 1n) >> 32n;

/** @param {bigint} value */
const reduced = (value) => {
  const rest = value % Q;

  return rest < 0n ? rest + Q : rest;
};

/**
 * @param {bigint} base
 * @param {bigint} exponent
 */
function power(base, exponent) {
  let result = 1n;
  let square = reduced(base);

  for (let left = exponent; left > 0n; left >>= 1n) {
    if (left & 1n) {
      result = (result * square) % Q;
    }

    square = (square * square) % Q;
  }

  return result;
}

/** A generator of the field's 2³²-th roots of unity, for square roots. */
const ROOT_OF_UNITY = power(7n, ODD);

/**
 * A square root in the field (Tonelli-Shanks), or null for a value with none.
 *
 * @param {bigint} value
 * @returns {bigint | null}
 */
function squareRoot(value) {
  if (value === 0n) {
    return 0n;
  }

  let order = 32n;
  let unit = ROOT_OF_UNITY;
  let rest = power(value, ODD);
  let root = power(value, (ODD + 1n) >> 1n);

  while (rest !== 1n) {
    let least = 0n;

    for (let square = rest; square !== 1n; square = (square * square) % Q) {
      least += 1n;

      if (least === order) {
        return null;
      }
    }

    const step = power(unit, 1n << (order - least - 1n));

    order = least;
    unit = (step * step) % Q;
    rest = (rest * unit) % Q;
    root = (root * step) % Q;
  }

  return root;
}

/**
 * A point in extended coordinates: [X, Y, Z, T] with u = X/Z, v = Y/Z, T = XY/Z.
 *
 * @typedef {[bigint, bigint, bigint, bigint]} Point
 */

/**
 * The curve's addition, which also doubles.
 *
 * @param {Point} a
 * @param {Point} b
 * @returns {Point}
 */
function add([x1, y1, z1, t1], [x2, y2, z2, t2]) {
  const xs = (x1 * x2) % Q;
  const ys = (y1 * y2) % Q;
  const c = (((D * t1) % Q) * t2) % Q;
  const d = (z1 * z2) % Q;
  const e = reduced((x1 + y1) * (x2 + y2) - xs - ys);
  const f = reduced(d - c);
  const g = (d + c) % Q;
  const h = (ys + xs) % Q;

  return [(e * f) % Q, (g * h) % Q, (f * g) % Q, (e * h) % Q];
}

/**
 * A compressed point, as the wallet core writes one: v in little-endian, with
 * the sign of u in its top bit. Null for what isn't one, as a v at or over Q.
 *
 * @param {Uint8Array} bytes
 * @returns {Point | null}
 */
function decompress(bytes) {
  let v = 0n;

  for (let at = 31; at >= 0; at -= 1) {
    v = (v << 8n) | BigInt(at === 31 ? bytes[at] & 0x7f : bytes[at]);
  }

  if (v >= Q) {
    return null;
  }

  const isOdd = Boolean(bytes[31] & 0x80);
  const squared = (v * v) % Q;
  const below = (1n + D * squared) % Q;
  const found = squareRoot(reduced(squared - 1n) * power(below, Q - 2n));

  if (found === null || (found === 0n && isOdd)) {
    return null;
  }

  const u = Boolean(found & 1n) === isOdd ? found : Q - found;

  return [u % Q, v, 1n, (u * v) % Q];
}

/**
 * Whether a point is of the group keys are made in, and not its neutral point.
 *
 * @param {Point} point
 */
function isKey(point) {
  /** @type {Point} */
  let total = [0n, 1n, 1n, 0n];

  for (let bit = 251n; bit >= 0n; bit -= 1n) {
    total = add(total, total);

    if ((ORDER >> bit) & 1n) {
      total = add(total, point);
    }
  }

  const [x, y, z] = point;
  const isNeutral = x === 0n && y === z;

  return total[0] === 0n && total[1] === total[2] && !isNeutral;
}

/**
 * @param {unknown} address
 * @returns {boolean}
 */
export default function isShieldedAddress(address) {
  const bytes = typeof address === "string" ? decodeBase58(address) : null;

  if (bytes?.length !== 64) {
    return false;
  }

  return [bytes.subarray(0, 32), bytes.subarray(32)].every((key) => {
    const point = decompress(key);

    return point !== null && isKey(point);
  });
}
