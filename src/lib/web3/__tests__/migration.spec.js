import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicClient, simulateContract, writeContract } from "@wagmi/core";
import {
  ChainMismatchError,
  InternalRpcError,
  TimeoutError,
  UnauthorizedProviderError,
  UserRejectedRequestError,
  encodeErrorResult,
  parseAbi,
} from "viem";
import { getContractError, getTransactionError } from "viem/utils";
import { ConnectorNotConnectedError } from "@wagmi/core";

import { describeFailure } from "$lib/transactions";

import migrationABI from "../abi/migrationABI.json";
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
      canRetry: true,
      sentence: "It was declined in your EVM wallet, so nothing was sent.",
    });

    vi.mocked(simulateContract).mockRejectedValue(new Error("It reverted."));

    expect(await failureOf(send)).not.toHaveProperty("outcomeUnknown");
    expect(writeContract).toHaveBeenCalledOnce();
  });
});

describe("what an EVM wallet's error proves", () => {
  /**
   * What a wallet's answer reaches the wallet as: wrapped by viem as its
   * `writeContract` wraps it.
   *
   * @param {Error} answer
   */
  const wrapped = (answer) =>
    getContractError(
      getTransactionError(/** @type {any} */ (answer), {
        account: null,
        chain: undefined,
      }),
      {
        abi: /** @type {any} */ (migrationABI),
        address: /** @type {`0x${string}`} */ (CONTRACT),
        args: [1n, "account"],
        functionName: "migrate",
        sender: /** @type {`0x${string}`} */ (OWNER),
      }
    );

  /**
   * A raw provider's error, as a wallet gives it.
   *
   * @param {number} code
   * @param {string} message
   * @param {unknown} [data]
   */
  const raw = (code, message, data) =>
    Object.assign(new Error(message), { code, data });

  const revertData = encodeErrorResult({
    abi: parseAbi(["error Error(string)"]),
    args: ["BEP20: transfer amount exceeds allowance"],
    errorName: "Error",
  });

  /** @param {Error} error */
  const failureFrom = async (error) => {
    vi.mocked(simulateContract).mockResolvedValue(
      /** @type {any} */ ({ request: {} })
    );
    vi.mocked(writeContract).mockRejectedValue(error);

    return failureOf(send);
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      "the node's words, as a wallet relays them",
      new InternalRpcError(
        raw(
          -32603,
          "execution reverted: BEP20: transfer amount exceeds allowance"
        )
      ),
    ],
    [
      "the revert's code, inside an internal error, as MetaMask gives it",
      new InternalRpcError(
        raw(-32603, "Internal JSON-RPC error.", {
          code: 3,
          data: revertData,
          message: "execution reverted: BEP20",
        })
      ),
    ],
    [
      "the revert's data alone",
      new InternalRpcError(
        raw(-32603, "Internal JSON-RPC error.", { data: revertData })
      ),
    ],
    [
      "a gas estimate that fails",
      raw(-32000, "gas required exceeds allowance (0)"),
    ],
  ])("says nothing went out for a revert: %s", async (_, answer) => {
    expect(await failureFrom(wrapped(answer))).toStrictEqual({
      canRetry: true,
      sentence:
        "The network would refuse it, so nothing was sent. See Details for why.",
    });
  });

  it.each([
    ["a wallet not connected", new ConnectorNotConnectedError()],
    [
      "a wallet on another chain, before it's asked",
      wrapped(
        new ChainMismatchError({
          chain: /** @type {any} */ ({ id: 56, name: "BNB Smart Chain" }),
          currentChainId: 1,
        })
      ),
    ],
  ])(
    "says nothing went out when the wallet wasn't asked: %s",
    async (_, error) => {
      expect(await failureFrom(error)).toStrictEqual({
        canRetry: true,
        sentence:
          "Your EVM wallet isn't on this account or network, so nothing was sent. Check it and try again.",
      });
    }
  );

  it("says nothing went out when the wallet won't, or was declined", async () => {
    expect(
      await failureFrom(
        wrapped(new UnauthorizedProviderError(new Error("Not authorized.")))
      )
    ).toStrictEqual({
      canRetry: true,
      sentence:
        "Your EVM wallet refused it, so nothing was sent. See Details for why.",
    });
    expect(
      await failureFrom(
        wrapped(new UserRejectedRequestError(new Error("Denied.")))
      )
    ).toStrictEqual({
      canRetry: true,
      sentence: "It was declined in your EVM wallet, so nothing was sent.",
    });
  });

  it("says nothing went out when the node finds too little to pay", async () => {
    expect(
      await failureFrom(
        wrapped(raw(-32000, "insufficient funds for gas * price + value"))
      )
    ).toMatchObject({ canRetry: true });
  });

  it.each([
    // viem words this one as "reverted with the following reason": it isn't.
    [
      "an internal error with nothing else",
      raw(-32603, "Internal JSON-RPC error."),
    ],
    [
      "an internal error from viem's own wrapping",
      new InternalRpcError(raw(-32603, "Internal JSON-RPC error.")),
    ],
    ["the same transaction known to the node", raw(-32000, "already known")],
    ["its nonce used", raw(-32000, "nonce too low")],
    ["a replacement", raw(-32000, "replacement transaction underpriced")],
    ["no answer", new TimeoutError({ body: {}, url: "https://wallet.test" })],
    ["a session gone", raw(4900, "The Provider is disconnected.")],
    ["a chain gone", raw(4901, "The Provider is not connected to the chain.")],
    ["a load failed", new TypeError("Failed to fetch")],
    ["no reason at all", raw(-32000, "")],
  ])(
    "never says nothing went out for what proves nothing: %s",
    async (_, answer) => {
      const failure = await failureFrom(wrapped(answer));

      expect(failure).toMatchObject({
        heading: "Not confirmed",
        outcomeUnknown: true,
      });
      expect(failure).not.toHaveProperty("canRetry");
    }
  );
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
