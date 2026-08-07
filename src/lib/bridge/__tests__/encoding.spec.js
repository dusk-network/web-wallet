import { describe, expect, it } from "vitest";
import {
  DUSK_EXTERNAL_ASSET_RECIPIENT_BYTES,
  compressedDuskBlsPublicKeyToRaw,
  encodeDuskExternalAssetRecipient,
  l2StandardBridgeAbi,
} from "@dusk/evm-sdk";
import { bytesToHex, decodeFunctionData, hexToBytes } from "viem";

import { encodeDepositETHToWithValueArgs } from "../deposit";
import { prepareNativeDuskWithdrawalCall } from "../withdrawalInitiation";
import depositRkyvFixtures from "./fixtures/deposit-rkyv";

const COMPRESSED_G2_GENERATOR =
  "93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8";

// Generated with dusk_bls12_381::G2Affine::generator().to_raw_bytes().
const RAW_G2_GENERATOR =
  "100a9402a28ff2f51a96b48726fbf5b380e52a3eb593a8a1e9ae3c1a9d9994986b36631863b7676fd7bc50439291810506f6239e75c0a9a5c360cdbc9dc5a0aa067886e2187eb13b67b34185ccb61a1b478515f20eedb6c2f3ed6073092a92114a4c4960f80a734c5a9c365e1ffa7c595a630aaa6c85e6e75f490d6ee9b5efbba225eff075a9d307e5da807e8efd83005db064df92fcc0addc61142b0a27aa18a0ebe43b6aacad863aa33dc94e5c4979edca3ca4505817e7f21bde63a1c22b0b00";

describe("bridge recipient encoding", () => {
  it("converts compressed Dusk account keys to Rust raw BLS bytes", () => {
    const raw = compressedDuskBlsPublicKeyToRaw(
      hexToBytes(`0x${COMPRESSED_G2_GENERATOR}`)
    );

    expect(bytesToHex(raw)).toBe(`0x${RAW_G2_GENERATOR}`);
  });

  it("encodes the current versioned external account recipient", () => {
    const recipient = encodeDuskExternalAssetRecipient(
      hexToBytes(`0x${COMPRESSED_G2_GENERATOR}`)
    );

    expect(hexToBytes(recipient)).toHaveLength(
      DUSK_EXTERNAL_ASSET_RECIPIENT_BYTES
    );
    expect(recipient.slice(0, 8)).toBe("0x020100");
    expect(recipient.slice(8)).toBe(RAW_G2_GENERATOR);
  });

  it("rejects malformed account public keys", () => {
    expect(() => compressedDuskBlsPublicKeyToRaw(new Uint8Array(95))).toThrow();
    expect(() => compressedDuskBlsPublicKeyToRaw(new Uint8Array(96))).toThrow();
  });

  it("prepares the canonical native withdrawal call through the SDK", () => {
    const amountWei = 1_000_000_000_000_000_000n;
    const bridgeAddress = "0x4200000000000000000000000000000000000010";
    const evmRecipient = "0x1111111111111111111111111111111111111111";
    const accountPublicKey = hexToBytes(`0x${COMPRESSED_G2_GENERATOR}`);
    const call = prepareNativeDuskWithdrawalCall({
      accountPublicKey: { valueOf: () => accountPublicKey },
      amountWei,
      bridgeAddress,
      evmRecipient,
      minGasLimit: 200_000,
    });
    const decoded = decodeFunctionData({
      abi: l2StandardBridgeAbi,
      data: call.data,
    });

    expect(call).toMatchObject({
      to: bridgeAddress,
      value: amountWei,
    });
    expect(decoded.functionName).toBe("bridgeETHTo");
    expect(decoded.args).toEqual([
      evmRecipient,
      200_000,
      encodeDuskExternalAssetRecipient(accountPublicKey),
    ]);
  });
});

describe("current bridge deposit payload encoding", () => {
  const to = "0x1111111111111111111111111111111111111111";

  it.each(depositRkyvFixtures)(
    "matches the Rust rkyv fixture for %#",
    ({ encoded, ...input }) => {
      expect(
        bytesToHex(
          encodeDepositETHToWithValueArgs({
            ...input,
            extraData: Array.from(input.extraData),
          })
        )
      ).toBe(encoded);
    }
  );

  it("rejects malformed deposit inputs", () => {
    const malformedExtraData = /** @type {any} */ ("not bytes");

    expect(() =>
      encodeDepositETHToWithValueArgs({
        amountLux: 2n ** 64n,
        minGasLimit: 150_000,
        to,
      })
    ).toThrow(RangeError);
    expect(() =>
      encodeDepositETHToWithValueArgs({
        amountLux: 123n,
        minGasLimit: 2 ** 32,
        to,
      })
    ).toThrow(RangeError);
    expect(() =>
      encodeDepositETHToWithValueArgs({
        amountLux: 123n,
        extraData: malformedExtraData,
        minGasLimit: 150_000,
        to,
      })
    ).toThrow(TypeError);
    expect(() =>
      encodeDepositETHToWithValueArgs({
        amountLux: 123n,
        minGasLimit: 150_000,
        to: "0x11111111111111111111111111111111111111",
      })
    ).toThrow(RangeError);
  });
});
