import { describe, expect, it } from "vitest";

import { decodeBridgeCall, evmAddressOf } from "../bridgeCalls";

import fixtures from "./fixtures/bridge-calls-testnet.json";

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

  it("should give a Dusk contract the EVM address DuskEVM gives it", () => {
    expect(evmAddressOf(contracts.bridge)).toBe(
      "2d2e08c0e8d64381db56bf2c942bc825602e61c3"
    );
    expect(evmAddressOf("not an id")).toBe("");
  });
});
