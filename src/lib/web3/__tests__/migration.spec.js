import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicClient, simulateContract, writeContract } from "@wagmi/core";

import { describeFailure } from "$lib/transactions";

import { getMigrationFee, migrate } from "../migration";

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getPublicClient: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
}));
vi.mock("../walletConnection", () => ({ wagmiConfig: {} }));

const CONTRACT = `0x${"11".repeat(20)}`;
const OWNER = `0x${"22".repeat(20)}`;
const send = () =>
  migrate(
    1n,
    56,
    "account",
    /** @type {`0x${string}`} */ (CONTRACT),
    /** @type {`0x${string}`} */ (OWNER)
  );

/** @param {() => Promise<unknown>} doing */
const failureOf = (doing) =>
  doing().then(
    () => {
      throw new Error("It didn't fail.");
    },
    (error) => describeFailure(error)
  );

describe("migrate", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("treats what the wallet answers once it was asked to send as of unknown outcome", async () => {
    vi.mocked(simulateContract).mockResolvedValue(
      /** @type {any} */ ({ request: {} })
    );
    vi.mocked(writeContract).mockRejectedValue(new Error("Timed out."));

    expect(await failureOf(send)).toMatchObject({ outcomeUnknown: true });
  });

  it("says nothing went out when the wallet declined, or the simulation failed", async () => {
    vi.mocked(simulateContract).mockResolvedValue(
      /** @type {any} */ ({ request: {} })
    );
    vi.mocked(writeContract).mockRejectedValue(
      new Error("User rejected the request.")
    );

    expect(await failureOf(send)).toStrictEqual({
      sentence: "It was declined in your EVM wallet, so nothing was sent.",
    });

    vi.mocked(simulateContract).mockRejectedValue(new Error("It reverted."));

    expect(await failureOf(send)).not.toHaveProperty("outcomeUnknown");
    expect(writeContract).toHaveBeenCalledOnce();
  });
});

describe("getMigrationFee", () => {
  const facts = {
    amount: 5n,
    chainId: 56,
    migrationContract: /** @type {`0x${string}`} */ (CONTRACT),
    owner: /** @type {`0x${string}`} */ (OWNER),
    recipient: "account",
    stableCoinAddress: /** @type {`0x${string}`} */ (CONTRACT),
  };

  /** @param {(call: any) => Promise<bigint>} estimate */
  const onChain = (estimate) =>
    vi.mocked(getPublicClient).mockReturnValue(
      /** @type {any} */ ({
        estimateContractGas: estimate,
        getGasPrice: async () => 10n,
      })
    );

  it("adds the approval to a migration that can't be estimated before it", async () => {
    onChain(async ({ functionName }) =>
      functionName === "approve" ? 50_000n : 1n
    );

    // What a migration takes when it can't be asked yet.
    expect(await getMigrationFee({ ...facts, approved: false })).toBe(
      10n * (50_000n + 70_000n)
    );
  });

  it("asks what the migration takes once it's approved, and falls back without an answer", async () => {
    onChain(async () => 60_000n);
    expect(await getMigrationFee({ ...facts, approved: true })).toBe(600_000n);

    onChain(async () => {
      throw new Error("It would revert.");
    });
    expect(await getMigrationFee({ ...facts, approved: true })).toBe(700_000n);
  });
});
