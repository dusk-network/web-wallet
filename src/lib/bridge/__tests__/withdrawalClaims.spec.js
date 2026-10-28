import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
  readWithdrawalClaims: vi.fn(),
  submitter: "0x2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c",
}));

vi.mock("$lib/stores", () => ({
  walletStore: {
    getDuskEvmProofSubmitter: () => mocks.submitter,
  },
}));

vi.mock("$lib/bridge/withdrawals", () => ({
  readWithdrawalClaims: mocks.readWithdrawalClaims,
}));

/** @param {number} byte */
const hashOf = (byte) =>
  /** @type {`0x${string}`} */ (`0x${byte.toString(16).repeat(64)}`);

/**
 * A proof or a claim of a withdrawal, as the history has it.
 *
 * @param {"claim" | "prove"} kind
 * @param {number} byte
 * @param {Partial<ActivityRow>} [fields]
 * @returns {ActivityRow}
 */
const row = (kind, byte, fields = {}) =>
  /** @type {ActivityRow} */ ({
    bridge: {
      amount: "1000000000",
      hash: hashOf(byte),
      kind,
      withdrawal: String(byte).padStart(64, "0"),
    },
    status: "executed",
    ...fields,
  });

/** @param {`0x${string}`[]} hashes */
const answer = (hashes) =>
  new Map(
    hashes.map((hash) => [
      hash,
      { at: 1, claimed: false, exact: false, overdue: false, ready: false },
    ])
  );

describe("withdrawalClaims", () => {
  /** @type {typeof import("../withdrawalClaims").default} */
  let withdrawalClaims;

  /** @type {typeof import("../withdrawalClaims").provedWithdrawals} */
  let provedWithdrawals;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mocks.submitter = `0x${"2c".repeat(20)}`;
    mocks.readWithdrawalClaims.mockReset();
    mocks.readWithdrawalClaims.mockImplementation(async (hashes) =>
      answer(hashes)
    );
    ({ default: withdrawalClaims, provedWithdrawals } =
      await import("../withdrawalClaims"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the withdrawals the history proved and no row claims, for the account's own proofs", async () => {
    const rows = [
      row("prove", 0xa),
      row("prove", 0xb),
      row("claim", 0xb),
      row("prove", 0xc, { status: "failed" }),
    ];

    expect(provedWithdrawals(rows)).toStrictEqual([hashOf(0xa)]);

    await withdrawalClaims.load(rows);

    expect(mocks.readWithdrawalClaims).toHaveBeenCalledExactlyOnceWith(
      [hashOf(0xa)],
      { submitter: mocks.submitter }
    );
    expect([...get(withdrawalClaims).keys()]).toStrictEqual([hashOf(0xa)]);
  });

  it("reads each at most once a minute, and a new one at once", async () => {
    await withdrawalClaims.load([row("prove", 0xa)]);
    await withdrawalClaims.load([row("prove", 0xa), row("prove", 0xd)]);

    expect(
      mocks.readWithdrawalClaims.mock.calls.map(([hashes]) => hashes)
    ).toStrictEqual([[hashOf(0xa)], [hashOf(0xd)]]);

    vi.advanceTimersByTime(60_000);
    await withdrawalClaims.load([row("prove", 0xa), row("prove", 0xd)]);

    expect(mocks.readWithdrawalClaims).toHaveBeenLastCalledWith(
      [hashOf(0xa), hashOf(0xd)],
      { submitter: mocks.submitter }
    );
    expect(get(withdrawalClaims).size).toBe(2);
  });

  it("starts over for another account, and reads again what couldn't be read", async () => {
    await withdrawalClaims.load([row("prove", 0xa)]);

    mocks.submitter = `0x${"3d".repeat(20)}`;
    mocks.readWithdrawalClaims.mockRejectedValueOnce(new Error("Offline"));
    await withdrawalClaims.load([row("prove", 0xa)]);

    expect(get(withdrawalClaims).size).toBe(0);

    await withdrawalClaims.load([row("prove", 0xa)]);

    expect(mocks.readWithdrawalClaims).toHaveBeenLastCalledWith([hashOf(0xa)], {
      submitter: `0x${"3d".repeat(20)}`,
    });
    expect(get(withdrawalClaims).size).toBe(1);
  });
});
