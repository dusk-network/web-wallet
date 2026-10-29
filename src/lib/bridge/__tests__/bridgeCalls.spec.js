import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { prepareNativeWithdrawal } from "@dusk/evm-sdk";

import {
  decodeBridgeCall,
  evmAddressOf,
  withdrawalCallRecipient,
  withdrawalRecipient,
} from "../bridgeCalls";

import fixtures from "./fixtures/bridge-calls-testnet.json";
import {
  PAID,
  PAID_EXTRA_DATA,
  relayedWithdrawal,
} from "./fixtures/withdrawal-recipient";

const { contracts } = fixtures;

/** @param {string} name */
const call = (name) => {
  const found = fixtures.calls.find((c) => c.name === name);

  if (!found) {
    throw new Error(`No fixture ${name}`);
  }

  return found;
};

/**
 * @param {string} name
 * @param {Record<string, unknown>} [over]
 */
const decode = (name, over = {}) => {
  const { args, fnName } = call(name);

  return decodeBridgeCall(
    {
      contractId:
        fnName === "depositETHToWithValue"
          ? contracts.bridge
          : contracts.portal,
      data: args,
      fnName,
      ...over,
    },
    contracts
  );
};

describe("decodeBridgeCall", () => {
  it("should read a deposit's DuskEVM address and amount", () => {
    for (const name of ["deposit", "deposit-shoot"]) {
      const { expected } = call(name);

      expect(decode(name)).toEqual({
        amount: expected.amountLux,
        kind: "deposit",
        to: expected.to,
      });
    }
  });

  it.each([
    ["prove-account", "prove"],
    ["prove-contract", "prove"],
    ["claim-account", "claim"],
    ["claim-contract", "claim"],
    ["claim-external-account", "claim"],
    ["claim-external-contract", "claim"],
  ])("should read %s: the withdrawal's amount and nonce", (name, kind) => {
    const out = decode(name);

    expect(out).toMatchObject({
      amount: (
        BigInt(String(call(name).expected.amountWei)) /
        10n ** 9n
      ).toString(),
      kind,
    });
    expect(out && "withdrawal" in out && out.withdrawal).toMatch(
      /^[0-9a-f]{64}$/
    );
  });

  it("should give a withdrawal's proof and claim the same nonce", () => {
    const withdrawal = (/** @type {string} */ name) => {
      const out = decode(name);

      return out && "withdrawal" in out ? out.withdrawal : null;
    };

    expect(withdrawal("prove-account")).toBe(withdrawal("claim-account"));
    expect(withdrawal("prove-account")).toBe(
      withdrawal("claim-external-account")
    );
    expect(withdrawal("prove-account")).not.toBe(withdrawal("prove-contract"));
  });

  it("should give a withdrawal's hash, which the Portal keys its proofs and claim by", () => {
    // wallet-both.dusk's proof on testnet, as sent: withdrawal 41's hash, as
    // DuskEVM's explorer has it.
    expect(decode("prove-wallet-both")).toStrictEqual({
      amount: "1000000000",
      hash: call("prove-wallet-both").expected.hash,
      kind: "prove",
      recipient:
        "21a5cb174bbd7dd0ae1c5bb76c989bb62fb82354aeec9fb25f548c43677dedd0",
      withdrawal: expect.stringMatching(/^0001[0-9a-f]{58}29$/),
    });

    /** @param {string} name */
    const hashOf = (name) => {
      const out = decode(name);

      return out && "hash" in out ? out.hash : null;
    };

    // A withdrawal's proof and its claims give the same hash; another's, another.
    expect(hashOf("prove-account")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashOf("claim-account")).toBe(hashOf("prove-account"));
    expect(hashOf("claim-external-account")).toBe(hashOf("prove-account"));
    expect(hashOf("prove-contract")).not.toBe(hashOf("prove-account"));
  });

  it("should read nothing for other contracts, and null for the bridge's calls that don't decode", () => {
    const { args } = call("deposit");

    expect(decode("deposit", { contractId: "ab".repeat(32) })).toBeUndefined();
    expect(decode("deposit", { contractId: undefined })).toBeUndefined();
    expect(decode("deposit", { data: `${args}00` })).toBeNull();
    expect(decode("deposit", { data: "zz" })).toBeNull();
    expect(decode("deposit", { fnName: "deposit" })).toBeNull();
    expect(
      decode("prove-account", { fnName: "finalizeWithdrawalTransaction" })
    ).toBeNull();
    expect(
      decode("claim-account", { data: call("claim-account").args.slice(0, -2) })
    ).toBeNull();
  });

  it("should read a withdrawal only on the bridge's own route", () => {
    const portalOnly = { bridge: "cd".repeat(32), portal: contracts.portal };
    const { args, fnName } = call("prove-account");

    expect(
      decodeBridgeCall(
        { contractId: contracts.portal, data: args, fnName },
        portalOnly
      )
    ).toBeNull();
  });

  it("should say whom a withdrawal pays on Dusk: an account, or a contract", () => {
    for (const name of ["prove-account", "claim-account"]) {
      expect(decode(name)).toMatchObject({ recipient: PAID });
    }

    for (const name of ["prove-contract", "claim-external-contract"]) {
      expect(decode(name)).toMatchObject({
        recipient: `21a5cb174bbd7dd0ae${"11".repeat(23)}`,
      });
    }
  });

  it("should read whom a withdrawal pays from its call on DuskEVM and from its message, as the SDK writes them", () => {
    const { data } = prepareNativeWithdrawal({
      amountWei: 10n ** 18n,
      extraData: PAID_EXTRA_DATA,
      minGasLimit: 200_000,
      recipient: "0x2222222222222222222222222222222222222222",
    }).l2Transaction;
    const relayed = relayedWithdrawal();
    const other = encodeFunctionData({
      abi: parseAbi(["function transfer(address, uint256)"]),
      args: ["0x2222222222222222222222222222222222222222", 1n],
    });

    expect(withdrawalCallRecipient(data)).toBe(PAID);
    expect(withdrawalRecipient(relayed)).toBe(PAID);

    // Any other call, or data that doesn't read, pays no one known.
    expect(withdrawalCallRecipient(other)).toBeNull();
    expect(withdrawalCallRecipient("0x")).toBeNull();
    expect(withdrawalRecipient(data)).toBeNull();
    expect(withdrawalRecipient(relayed.slice(0, -64))).toBeNull();
    expect(withdrawalRecipient(relayedWithdrawal("0x0201"))).toBeNull();
  });

  it("should give a Dusk contract the EVM address DuskEVM gives it", () => {
    expect(evmAddressOf(contracts.bridge)).toBe(
      "2d2e08c0e8d64381db56bf2c942bc825602e61c3"
    );
    expect(evmAddressOf("not an id")).toBe("");
  });
});
