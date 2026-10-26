import { encodeU64 } from "./amounts";
import { SOZU_FN } from "./config";

/**
 * A call of Sozu's pool as a transaction carries it: the pool, the function
 * and the amount in DUSK's lux. A stake sends the amount along as its
 * deposit; an unstake sends nothing.
 *
 * @param {string} poolId The pool's contract ID, in hex
 * @param {typeof SOZU_FN[keyof typeof SOZU_FN]} fnName
 * @param {bigint} amount
 * @returns {{ deposit: bigint, payload: { contractId: number[], fnArgs: Uint8Array, fnName: string } }}
 */
export function sozuCall(poolId, fnName, amount) {
  const hex = String(poolId).toLowerCase().replace(/^0x/, "");

  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new TypeError("Not a contract ID");
  }

  if (amount <= 0n) {
    throw new RangeError("The amount must be more than 0");
  }

  return {
    deposit: fnName === SOZU_FN.STAKE ? amount : 0n,
    payload: {
      contractId: Array.from(hex.match(/../g) ?? [], (byte) =>
        parseInt(byte, 16)
      ),
      fnArgs: encodeU64(amount),
      fnName,
    },
  };
}
