// Whom a withdrawal pays on Dusk, as the bridge carries it: a testnet
// account, the one testnet's withdrawal of 1,008 DUSK pays, and the
// `extraData` the DuskEVM SDK writes for it.
import { encodeDuskExternalAssetRecipient } from "@dusk/evm-sdk";

export const PAID =
  "21n5ncyuJkRr9JRoxvWRLMcqcWxmVSSLdefDMTwQeNyZZikU5dcXuawf9kNuG1CxFvz32oBM965PQ2PCcWrwX8YX9a7fqaaQ6fabDhxW5mveEyAt4LgdY3KLH9iKtSfMMLNz";

const DIGITS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The account's key, as Dusk compresses it: its base58, read back. */
const key = () => {
  let value = 0n;

  for (const character of PAID) {
    value = value * 58n + BigInt(DIGITS.indexOf(character));
  }

  return Uint8Array.from(
    value.toString(16).padStart(192, "0").match(/../g) ?? [],
    (b) => parseInt(b, 16)
  );
};

export const PAID_EXTRA_DATA = encodeDuskExternalAssetRecipient(key());
