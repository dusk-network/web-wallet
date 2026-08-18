export const CURRENT_WALLET_ENCRYPTION_VERSION = 1;
export const LEGACY_PBKDF2_ITERATIONS = 10_000;
export const CURRENT_PBKDF2_ITERATIONS = 600_000;

/**
 * @param {number | undefined} version
 * @returns {number}
 */
export function getWalletEncryptionIterations(version) {
  if (version === undefined) {
    return LEGACY_PBKDF2_ITERATIONS;
  }

  if (version === CURRENT_WALLET_ENCRYPTION_VERSION) {
    return CURRENT_PBKDF2_ITERATIONS;
  }

  throw new Error(`Unsupported wallet encryption version: ${version}`);
}
