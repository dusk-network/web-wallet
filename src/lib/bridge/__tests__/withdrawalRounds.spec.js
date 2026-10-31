/**
 * Bridge › Activity follows each withdrawal that isn't settled yet. Here,
 * through the wallet's own tracking and reads, with the package's answers
 * scripted where the wallet hands over to it: what each withdrawal shows
 * over five minutes, and how many checks and reads of Dusk's latest block
 * that takes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";

/** The package as the wallet makes it, and every check it was asked for. */
const pkg = vi.hoisted(() => ({
  /** @type {Map<string, (at: number) => any>} */
  answers: new Map(),
  /** @type {Array<{ at: number, tx: string }>} */
  checks: [],
  /** @type {Map<string, number>} */
  latency: new Map(),
}));

/** When Dusk's latest block was read. */
const tips = vi.hoisted(() => ({ reads: /** @type {number[]} */ ([]) }));

vi.mock(
  "@dusk-network/app-core/duskevm-withdrawals",
  async (importOriginal) => ({
    .../** @type {object} */ (await importOriginal()),
    createWithdrawals: vi.fn((/** @type {any} */ options) => ({
      /**
       * A withdrawal's status, after its reads take their time. As the
       * package does, one whose proof's game is known reads Dusk's latest
       * block with it.
       *
       * @param {string} tx
       * @param {{ proofGame?: string | null }} [asked]
       */
      async status(tx, asked = {}) {
        pkg.checks.push({ at: Date.now(), tx });

        if (asked.proofGame) {
          await options.latestBlock();
        }

        await new Promise((done) => setTimeout(done, pkg.latency.get(tx) ?? 0));

        return /** @type {(at: number) => any} */ (pkg.answers.get(tx))(
          Date.now()
        );
      },
    })),
  })
);

vi.mock("$lib/stores", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  networkStore: {
    connect: vi.fn(),
    getLatestBlock: vi.fn(async () => {
      tips.reads.push(Date.now());

      return {
        height: 4_736_000n,
        timestamp: BigInt(Math.floor(Date.now() / 1_000)),
      };
    }),
  },
  walletStore: {
    getDuskEvmProofSubmitter: () => `0x${"97".repeat(20)}`,
  },
}));

const START = Date.parse("2026-10-31T12:00:00.000Z");
const ACCOUNT = `0x${"97".repeat(20)}`;
const GAME = `0x${"6f".repeat(20)}`;

/** @param {string} byte */
const txOf = (byte) => /** @type {`0x${string}`} */ (`0x${byte.repeat(32)}`);

/** Not covered by an output yet. */
const WAITING = txOf("a1");

/** Proved, claimable 90 seconds in. */
const SOON = txOf("b2");

/** Proved, claimable in three days. */
const LATER = txOf("c3");

/**
 * A status as the package gives it.
 *
 * @param {string} tx
 * @param {Record<string, unknown>} fields
 */
const status = (tx, fields) => ({
  blockNumber: 2_580_123n,
  facts: { amountWei: 10n ** 18n },
  proofRejected: false,
  proofSubmitter: ACCOUNT,
  proofSubmitterCount: 0n,
  reason: null,
  transactionHash: tx,
  withdrawalHash: `0x${"8e".repeat(32)}`,
  ...fields,
});

/**
 * A proof waiting for its claim date, until that date.
 *
 * @param {string} tx
 * @param {number} readyAt
 */
const provedUntil = (tx, readyAt) => (/** @type {number} */ at) =>
  status(tx, {
    disputeGameProxy: GAME,
    proofSubmitterCount: 1n,
    readyAt: BigInt(readyAt / 1_000),
    readyAtExact: true,
    stage: at >= readyAt ? "ready_to_finalize" : "proven_waiting",
  });

describe("Bridge › Activity's checks of the withdrawals it follows", () => {
  /** @type {typeof import("$lib/bridge/withdrawalTracking")} */
  let tracking;

  /** @type {typeof import("$lib/bridge/withdrawalActivityStorage")} */
  let storage;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    localStorage.clear();
    vi.resetModules();

    const { setNodeNetwork } = await import("$lib/stores/nodeNetwork");

    setNodeNetwork(networks.testnet);
    tracking = await import("$lib/bridge/withdrawalTracking");
    storage = await import("$lib/bridge/withdrawalActivityStorage");
    pkg.answers.clear();
    pkg.checks.length = 0;
    pkg.latency.clear();
    tips.reads.length = 0;

    // Anything else the wallet would ask: nothing should.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("No other reads");
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Keeps a withdrawal as an earlier session left it.
   *
   * @param {`0x${string}`} tx
   * @param {Record<string, unknown>} fields
   */
  const kept = (tx, fields) => {
    storage.rememberWithdrawalTransaction(tx, { account: ACCOUNT });
    storage.updateWithdrawalTransaction(tx, {
      sentAt: "2026-10-30T09:00:00.000Z",
      ...fields,
    });
  };

  /** @param {string} tx */
  const checksOf = (tx) =>
    pkg.checks.filter((check) => check.tx === tx).map(({ at }) => at - START);

  /** @param {`0x${string}`} tx */
  const shown = (tx) => storage.getRememberedWithdrawalTransaction(tx);

  it("checks the ones due together, with one read of the latest block, and a proof again only from its claim date", async () => {
    pkg.answers.set(WAITING, () =>
      status(WAITING, { reason: "no-output", stage: "waiting_for_output" })
    );
    pkg.answers.set(SOON, provedUntil(SOON, START + 90_000));
    pkg.answers.set(LATER, provedUntil(LATER, START + 3 * 86_400_000));
    // Their reads take their own time.
    pkg.latency.set(WAITING, 400);
    pkg.latency.set(SOON, 100);
    pkg.latency.set(LATER, 250);
    kept(WAITING, { stage: "waiting_for_output" });
    kept(SOON, { proofGame: GAME, stage: "proven_waiting" });
    kept(LATER, { proofGame: GAME, stage: "proven_waiting" });

    expect(tracking.resumeWithdrawalTracking(ACCOUNT)).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    // What Bridge › Activity shows.
    expect(shown(WAITING)?.stage).toBe("waiting_for_output");
    expect(shown(SOON)?.stage).toBe("ready_to_finalize");
    expect(shown(LATER)).toEqual(
      expect.objectContaining({
        readyAt: String((START + 3 * 86_400_000) / 1_000),
        stage: "proven_waiting",
      })
    );

    // A proof is checked again only from its claim date, and is ready
    // within a poll of it.
    expect(checksOf(LATER)).toStrictEqual([0]);
    expect(checksOf(SOON).filter((at) => at > 0 && at < 90_000)).toEqual([]);
    expect(checksOf(SOON)[1]).toBeLessThan(90_000 + 15_000);

    // The one waiting for an output is checked every poll, and the others
    // due then are checked with it, in the same round.
    expect(checksOf(WAITING)).toStrictEqual(
      Array.from({ length: 21 }, (_, i) => i * 15_000)
    );
    for (const at of checksOf(SOON)) {
      expect(checksOf(WAITING)).toContain(at);
    }

    // Dusk's latest block is read once a round, however many ask for it:
    // the first round's two proofs share one read.
    const rounds = new Set(pkg.checks.map(({ at }) => at));

    expect(tips.reads.filter((at) => at === START)).toHaveLength(1);
    expect(new Set(tips.reads).size).toBe(tips.reads.length);
    expect(tips.reads.every((at) => rounds.has(at))).toBe(true);

    // In all, 38 checks and 16 reads of the latest block, where a tracker
    // each, every 15 seconds, made 63 and 42.
    expect(pkg.checks).toHaveLength(38);
    expect(tips.reads).toHaveLength(16);

    // Nothing else was asked.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks a withdrawal at once once its proof is sent, then every 5 seconds until the Portal shows it", async () => {
    let proved = false;

    pkg.answers.set(WAITING, () =>
      status(WAITING, { reason: "no-output", stage: "waiting_for_output" })
    );
    pkg.answers.set(SOON, () =>
      proved
        ? status(SOON, {
            disputeGameProxy: GAME,
            proofSubmitterCount: 1n,
            readyAt: BigInt((START + 86_400_000) / 1_000),
            readyAtExact: false,
            stage: "proven_waiting",
          })
        : status(SOON, { stage: "ready_to_prove" })
    );
    kept(WAITING, { stage: "waiting_for_output" });
    kept(SOON, { stage: "ready_to_prove" });
    tracking.resumeWithdrawalTracking(ACCOUNT);

    await vi.advanceTimersByTimeAsync(20_000);

    expect(checksOf(SOON)).toStrictEqual([0, 15_000]);

    // The proof is sent on Dusk at 20 seconds, and the Portal shows it 12
    // seconds later.
    tracking.recordWithdrawalSubmission(SOON, {
      action: "prove",
      hash: "66".repeat(32),
    });

    expect(shown(SOON)?.stage).toBe("prove_submitted");

    await vi.advanceTimersByTimeAsync(12_000);
    proved = true;
    await vi.advanceTimersByTimeAsync(8_000);

    // At once, then about every 5 seconds.
    expect(
      checksOf(SOON)
        .filter((at) => at >= 20_000)
        .map((at) => Math.round(at / 100) * 100)
    ).toStrictEqual([20_000, 25_000, 30_000, 35_000]);
    expect(shown(SOON)).toEqual(
      expect.objectContaining({
        pendingAction: null,
        pendingTransactionHash: null,
        stage: "proven_waiting",
      })
    );

    // Then it waits for its claim date, while the other goes on.
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(checksOf(SOON).filter((at) => at > 35_000)).toEqual([]);
    expect(checksOf(WAITING).length).toBeGreaterThan(20);
  });
});
