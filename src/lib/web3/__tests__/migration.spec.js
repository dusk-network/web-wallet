import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateContract, writeContract } from "@wagmi/core";

import { describeFailure } from "$lib/transactions";

import { migrate } from "../migration";

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
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
