import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import { rowsOf } from "$lib/activity/__tests__/fixtures/rows";

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
 * The history's proofs and claims of withdrawals, in the order given: each
 * its kind, the byte its withdrawal's hash repeats, and more about it.
 *
 * @param {...["claim" | "prove", number, Record<string, unknown>?]} steps
 */
const history = (...steps) =>
  rowsOf(
    steps.map(([kind, byte, fields], i) => ({
      amount: "0",
      blockHeight: 4_687_000,
      bridge: {
        amount: "1000000000",
        hash: hashOf(byte),
        kind,
        withdrawal: String(byte).padStart(64, "0"),
      },
      contractId: "ab".repeat(32),
      hash: String(i + 1).padStart(64, "0"),
      kind: "contract_call",
      status: "executed",
      timestamp: 1,
      ...fields,
    }))
  );

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
    const rows = history(
      ["prove", 0xa],
      ["prove", 0xb],
      ["claim", 0xb],
      ["prove", 0xc, { status: "failed" }]
    );

    expect(provedWithdrawals(rows)).toStrictEqual([hashOf(0xa)]);

    await withdrawalClaims.load(rows);

    expect(mocks.readWithdrawalClaims).toHaveBeenCalledExactlyOnceWith(
      [hashOf(0xa)],
      { submitter: mocks.submitter }
    );
    expect([...get(withdrawalClaims).keys()]).toStrictEqual([hashOf(0xa)]);
  });

  it("reads each at most once a minute, and a new one at once", async () => {
    await withdrawalClaims.load(history(["prove", 0xa]));
    await withdrawalClaims.load(history(["prove", 0xa], ["prove", 0xd]));

    expect(
      mocks.readWithdrawalClaims.mock.calls.map(([hashes]) => hashes)
    ).toStrictEqual([[hashOf(0xa)], [hashOf(0xd)]]);

    vi.advanceTimersByTime(60_000);
    await withdrawalClaims.load(history(["prove", 0xa], ["prove", 0xd]));

    expect(mocks.readWithdrawalClaims).toHaveBeenLastCalledWith(
      [hashOf(0xa), hashOf(0xd)],
      { submitter: mocks.submitter }
    );
    expect(get(withdrawalClaims).size).toBe(2);
  });

  it("keeps a load that comes while one reads, and reads the last of them once it's done", async () => {
    /** @type {() => void} */
    let finish = () => {};

    mocks.readWithdrawalClaims.mockImplementationOnce(
      (hashes) =>
        new Promise((resolve) => {
          finish = () => resolve(answer(hashes));
        })
    );

    const first = withdrawalClaims.load(history(["prove", 0xa]));

    // While it reads: new rows, then another account's.
    void withdrawalClaims.load(history(["prove", 0xa], ["prove", 0xd]));
    mocks.submitter = `0x${"3d".repeat(20)}`;
    void withdrawalClaims.load(history(["prove", 0xe]));

    expect(mocks.readWithdrawalClaims).toHaveBeenCalledOnce();

    finish();
    await first;

    expect(mocks.readWithdrawalClaims).toHaveBeenCalledTimes(2);
    expect(mocks.readWithdrawalClaims).toHaveBeenLastCalledWith([hashOf(0xe)], {
      submitter: `0x${"3d".repeat(20)}`,
    });
    expect([...get(withdrawalClaims).keys()]).toStrictEqual([hashOf(0xe)]);
  });

  it("starts over for another account, and reads again what couldn't be read", async () => {
    await withdrawalClaims.load(history(["prove", 0xa]));

    mocks.submitter = `0x${"3d".repeat(20)}`;
    mocks.readWithdrawalClaims.mockRejectedValueOnce(new Error("Offline"));
    await withdrawalClaims.load(history(["prove", 0xa]));

    expect(get(withdrawalClaims).size).toBe(0);

    await withdrawalClaims.load(history(["prove", 0xa]));

    expect(mocks.readWithdrawalClaims).toHaveBeenLastCalledWith([hashOf(0xa)], {
      submitter: `0x${"3d".repeat(20)}`,
    });
    expect(get(withdrawalClaims).size).toBe(1);
  });
});
