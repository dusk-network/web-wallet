// Whom a withdrawal pays on Dusk, as the bridge carries it: a testnet
// account, the one testnet's withdrawal of 1,008 DUSK pays, and the
// `extraData` the DuskEVM SDK writes for it.
import { encodeDuskExternalAssetRecipient } from "@dusk/evm-sdk";
import { encodeFunctionData, parseAbi } from "viem";

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

/**
 * A withdrawal's message as DuskEVM passes it: the messenger's relay of
 * the bridge's `finalizeBridgeETH`, carrying `extraData`.
 *
 * @param {`0x${string}`} [extraData]
 */
export const relayedWithdrawal = (extraData = PAID_EXTRA_DATA) =>
  encodeFunctionData({
    abi: parseAbi([
      "function relayMessage(uint256, address, address, uint256, uint256, bytes)",
    ]),
    args: [
      1n,
      "0x4200000000000000000000000000000000000010",
      "0x2d2e08c0e8d64381db56bf2c942bc825602e61c3",
      10n ** 18n,
      200_000n,
      encodeFunctionData({
        abi: parseAbi([
          "function finalizeBridgeETH(address, address, uint256, bytes)",
        ]),
        args: [
          "0x7568a1b3cc6b2f2e3e8fdd2fa77e0c5a0dbcb72d",
          "0x2222222222222222222222222222222222222222",
          10n ** 18n,
          extraData,
        ],
      }),
    ],
  });
