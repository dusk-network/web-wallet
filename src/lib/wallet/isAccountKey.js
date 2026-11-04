import { decodeBase58 } from "@dusk-network/networks/account";
import { bls12_381 } from "@noble/curves/bls12-381";

/**
 * Whether a public account is a key at all. An account has no checksum, but a
 * mistyped one lands off the curve, so this catches it before it's sent.
 *
 * @param {string} account
 * @returns {boolean}
 */
export default function isAccountKey(account) {
  try {
    const bytes = decodeBase58(account);

    if (bytes?.length !== 96) {
      return false;
    }

    bls12_381.G2.ProjectivePoint.fromHex(bytes).assertValidity();

    return true;
  } catch {
    return false;
  }
}
