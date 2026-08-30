import {
  encodeDuskExternalAssetRecipient,
  prepareNativeWithdrawal,
} from "@dusk/evm-sdk";
import { getAddress } from "viem";

/**
 * Compose wallet account state with the SDK's canonical recipient and L2 call
 * encoders. Proof discovery and L1 finalization remain wallet-owned.
 *
 * @param {object} options
 * @param {unknown} options.accountPublicKey
 * @param {bigint} options.amountWei
 * @param {string} options.evmRecipient
 * @param {number} options.minGasLimit
 */
export function prepareNativeDuskWithdrawalCall({
  accountPublicKey,
  amountWei,
  evmRecipient,
  minGasLimit,
}) {
  const extraData = encodeDuskExternalAssetRecipient(
    accountPublicKeyBytes(accountPublicKey)
  );

  return prepareNativeWithdrawal({
    amountWei,
    extraData,
    minGasLimit,
    recipient: getAddress(evmRecipient),
  }).l2Transaction;
}

/**
 * W3sper account identifiers expose their compressed key through `valueOf()`.
 *
 * @param {unknown} accountPublicKey
 */
function accountPublicKeyBytes(accountPublicKey) {
  if (accountPublicKey instanceof Uint8Array) {
    return accountPublicKey;
  }

  if (
    accountPublicKey &&
    typeof accountPublicKey === "object" &&
    "valueOf" in accountPublicKey
  ) {
    const bytes = accountPublicKey.valueOf();

    if (bytes instanceof Uint8Array) {
      return bytes;
    }
  }

  throw new TypeError("Dusk account public key is not available as bytes.");
}
