import { describe, expect, it } from "vitest";

import fixture from "./fixtures/activity-testnet.json";
import {
  historyEntry,
  parseHistoryEntry,
} from "@dusk-network/app-core/history";
import { historyRow, mergeActivity } from "../activityMerge";

const [A, B, C] = Object.keys(fixture.accounts);
const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

/** @type {Record<string, { receiver: any[], sender: any[] }>} */
const accounts = /** @type {any} */ (fixture.accounts);

/** @type {Record<string, any>} */
const details = fixture.details;

/**
 * An account's entry as the history reads it: parsed, with its details.
 *
 * @param {string} account
 * @param {number} height
 * @returns {ActivityEntry}
 */
function entry(account, height) {
  const raw = [...accounts[account].sender, ...accounts[account].receiver].find(
    (e) => e.block_height === height
  );
  const parsed =
    /** @type {import("@dusk-network/app-core/history").HistoryEntry} */ (
      parseHistoryEntry(account, raw)
    );
  const tx = details[parsed.hash];

  return historyEntry({
    ...parsed,
    contractId: tx.tx.callData?.contractId,
    detailsAt: 1,
    error: tx.err ?? undefined,
    fee: String(tx.gasSpent * tx.tx.gasPrice),
    fnName: tx.tx.callData?.fnName,
    success: !tx.err,
    timestamp: tx.blockTimestamp * 1000,
    value: parsed.value.toString(),
  });
}

const received = () => entry(A, 4657992);
const registered = () => entry(A, 4658012);

describe("historyRow", () => {
  it("gives a received transfer its sender, and a call its contract and deposit", () => {
    expect(historyRow(received())).toMatchObject({
      amount: "1000000000000",
      direction: "in",
      from: received().counterparty,
      kind: "transfer",
      privacy: "public",
      source: "archive",
      status: "executed",
      to: undefined,
    });
    expect(historyRow(registered())).toMatchObject({
      contractId: STORE,
      deposit: "100000000000",
      direction: "out",
      feePaid: "2897558",
      fnName: "register",
      kind: "contract_call",
      to: undefined,
    });
    // With the name it registered, once that's read.
    expect(
      historyRow({ ...registered(), registeredName: "alice.dusk" })
    ).toMatchObject({ registeredName: "alice.dusk" });
  });

  it("leaves an entry whose outcome isn't looked up yet unknown, not executed", () => {
    const unknown = {
      ...received(),
      detailsAt: undefined,
      success: null,
      timestamp: null,
    };

    expect(historyRow(unknown)).toMatchObject({
      status: "unknown",
      success: null,
    });
  });

  it("marks a failed transaction failed with its error", () => {
    expect(historyRow(entry(B, 3407780))).toMatchObject({
      error: "Panic: DRC20Phoenix: invalid proof",
      status: "failed",
    });
  });

  it("reads a call that sent its value to its own account as the call it was, once its call data came", () => {
    // Derived: A's register call as it would read had it sent 5 DUSK to itself.
    const call = historyEntry(
      /** @type {ActivityStoredEntry} */ (
        /** @type {unknown} */ ({
          ...registered(),
          counterparty: A,
          direction: "self",
          kind: "transfer",
          payer: true,
          value: "5000000000",
        })
      )
    );

    expect(historyRow(call)).toMatchObject({
      amount: "0",
      contractId: STORE,
      direction: "out",
      fnName: "register",
      kind: "contract_call",
    });
    expect(historyRow(call).to).toBeUndefined();
    expect(historyRow(call).deposit).toBeUndefined();

    // Before its details, it is the transfer it reads as.
    expect(
      historyRow({ ...call, contractId: undefined, fnName: undefined })
    ).toMatchObject({ direction: "self", kind: "transfer" });
  });
});

describe("mergeActivity", () => {
  it("replaces the wallet's pending record with the final entry, keeping the name typed for the recipient", () => {
    const pending = {
      hash: registered().hash,
      kind: "contract_call",
      origin: "https://app.example",
      profileIndex: 0,
      status: "submitted",
      submittedAt: 1_792_687_500_000,
      toName: "shpongle.dusk",
    };
    const [row] = mergeActivity({
      history: [registered()],
      local: [pending],
      profileIndex: 0,
    });

    expect(row).toMatchObject({
      amount: "100000000000",
      origin: "https://app.example",
      profileIndex: 0,
      source: "both",
      status: "executed",
      timestamp: 1_792_687_511_000,
      toName: "shpongle.dusk",
    });
  });

  it("keeps what the wallet knows of a bridge call until the chain's row reads it", () => {
    const bridge = /** @type {const} */ ({
      amount: "100000000000",
      kind: "deposit",
      to: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    });
    const pending = {
      bridge,
      contractId: "2257".padEnd(64, "0"),
      fnName: "depositETHToWithValue",
      hash: registered().hash,
      kind: "contract_call",
      profileIndex: 0,
      status: "submitted",
      submittedAt: 1_792_687_500_000,
    };
    const [alone] = mergeActivity({ local: [pending], profileIndex: 0 });
    const [both] = mergeActivity({
      history: [{ ...registered(), bridge: undefined }],
      local: [pending],
      profileIndex: 0,
    });

    expect(alone).toMatchObject({
      bridge,
      contractId: pending.contractId,
      fnName: pending.fnName,
      source: "local",
    });
    expect(both).toMatchObject({ bridge, source: "both" });
  });

  it("takes a row the archive has as final: the outcome the wallet saw, else unknown until its details come", () => {
    const unknown = { ...registered(), detailsAt: undefined, success: null };

    for (const [status, shown] of [
      ["submitted", "unknown"],
      ["mempool", "unknown"],
      ["unknown", "unknown"],
      ["removed", "unknown"],
      ["failed", "failed"],
      ["executed", "executed"],
    ]) {
      const local = {
        error: status === "failed" ? "OutOfGas" : undefined,
        hash: unknown.hash,
        kind: "contract_call",
        profileIndex: 0,
        status,
      };
      const [row] = mergeActivity({
        history: [unknown],
        local: [local],
        profileIndex: 0,
      });

      expect(row).toMatchObject({
        detailsAt: undefined,
        error: shown === "failed" ? "OutOfGas" : undefined,
        source: "both",
        status: shown,
      });
    }
  });

  it("takes a shielded row's outcome over the wallet's own that stopped waiting", () => {
    const hash = "ab".repeat(32);
    const local = {
      amount: "5",
      hash,
      kind: /** @type {const} */ ("transfer"),
      profileIndex: 0,
      status: /** @type {const} */ ("unknown"),
    };

    for (const [status, error] of /** @type {const} */ ([
      ["executed", undefined],
      ["failed", "Panic: out of gas"],
    ])) {
      /** @type {ActivityRow[]} */
      const shielded = [
        {
          amount: "5",
          blockHeight: 9,
          direction: "out",
          error,
          feePaid: "1",
          hash,
          kind: "transfer",
          privacy: "shielded",
          source: "shielded",
          status,
        },
      ];
      const [row] = mergeActivity({
        local: [local],
        profileIndex: 0,
        shielded,
      });

      expect(row).toMatchObject({ error, source: "both", status });
    }
  });

  it("keeps the memo and the name the wallet sent a shielded transfer with", () => {
    const hash = "ab".repeat(32);
    const [row] = mergeActivity({
      local: [
        {
          amount: "5",
          hash,
          kind: "transfer",
          memo: "Invoice 42",
          privacy: "shielded",
          profileIndex: 0,
          status: "submitted",
          toName: "alice.dusk",
        },
      ],
      profileIndex: 0,
      shielded: [
        {
          amount: "5",
          blockHeight: 9,
          direction: "out",
          hash,
          kind: "transfer",
          privacy: "shielded",
          source: "shielded",
          status: "executed",
        },
      ],
    });

    expect(row).toMatchObject({
      memo: "Invoice 42",
      source: "both",
      status: "executed",
      toName: "alice.dusk",
    });
  });

  it("shows a settled record only with the chain's row of it", () => {
    const settled = {
      amount: "5",
      hash: "cd".repeat(32),
      kind: /** @type {const} */ ("transfer"),
      profileIndex: 0,
      settled: true,
      status: /** @type {const} */ ("submitted"),
      toName: "alice.dusk",
    };

    expect(mergeActivity({ local: [settled], profileIndex: 0 })).toEqual([]);
  });

  it("keeps the amount a send meant to move when it didn't go through, and the chain's when it did", () => {
    // B's call that failed on chain: what it sent with it never moved.
    const failed = entry(B, 3407780);
    const local = {
      amount: "2000000000",
      hash: failed.hash,
      kind: /** @type {const} */ ("contract_call"),
      profileIndex: 0,
      status: /** @type {const} */ ("failed"),
    };
    const [row] = mergeActivity({
      history: [failed],
      local: [local],
      profileIndex: 0,
    });

    expect(row).toMatchObject({
      amount: "2000000000",
      source: "both",
      status: "failed",
    });

    // A's register went through: the chain's amount stands.
    const done = registered();
    const [ok] = mergeActivity({
      history: [done],
      local: [{ ...local, amount: "1", hash: done.hash }],
      profileIndex: 0,
    });

    expect(ok).toMatchObject({ amount: "100000000000", status: "executed" });
  });

  it("gives an unshield the fee its shielded side paid", () => {
    // C's unshield at 3602438: the fee was paid from the shielded notes.
    const unshield = entry(C, 3602438);

    expect(unshield.fee).toBeNull();

    /** @type {ActivityRow[]} */
    const shielded = [
      {
        direction: "out",
        feePaid: "12429102",
        hash: unshield.hash,
        kind: "unshield",
        privacy: "shielded",
        source: "shielded",
        status: "executed",
      },
    ];
    const [row] = mergeActivity({ history: [unshield], shielded });

    expect(row).toMatchObject({
      direction: "in",
      feePaid: "12429102",
      kind: "unshield",
      source: "archive",
    });
  });

  it("keeps the wallet's own sends the archive doesn't have yet, shielded ones included, newest first", () => {
    const local = [
      {
        hash: "aa".repeat(32),
        kind: "transfer",
        privacy: "public",
        profileIndex: 0,
        status: "mempool",
        submittedAt: 1_792_700_000_000,
      },
      {
        hash: "bb".repeat(32),
        kind: "transfer",
        privacy: "shielded",
        profileIndex: 0,
        status: "executed",
        submittedAt: 1_700_000_000_000,
      },
    ];
    const rows = mergeActivity({
      history: [registered(), received()],
      local,
      profileIndex: 0,
    });

    expect(rows.map((r) => [r.hash.slice(0, 4), r.source, r.status])).toEqual([
      ["aaaa", "local", "mempool"],
      [registered().hash.slice(0, 4), "archive", "executed"],
      [received().hash.slice(0, 4), "archive", "executed"],
      ["bbbb", "local", "executed"],
    ]);
  });

  it("shows the selected profile's own records, and records without a profile", () => {
    const local = [
      {
        hash: "aa".repeat(32),
        profileIndex: 1,
        status: "submitted",
        submittedAt: 3,
      },
      {
        hash: "bb".repeat(32),
        profileIndex: 0,
        status: "submitted",
        submittedAt: 2,
      },
      { hash: "cc".repeat(32), status: "submitted", submittedAt: 1 },
    ];

    expect(
      mergeActivity({ local, profileIndex: 0 }).map((r) => r.hash.slice(0, 2))
    ).toEqual(["bb", "cc"]);

    // Without a profile: every profile's.
    expect(mergeActivity({ local }).map((r) => r.hash.slice(0, 2))).toEqual([
      "aa",
      "bb",
      "cc",
    ]);
  });

  it("names counterparties only with a verified name", () => {
    const other = entry(A, 4655845);

    /** @type {Map<string, string | null>} */
    const names = new Map([
      [String(received().counterparty), "faucet.dusk"],
      [String(other.counterparty), null],
    ]);
    const rows = mergeActivity({ history: [received(), other], names });

    expect(rows.map((r) => r.counterpartyName)).toEqual([
      "faucet.dusk",
      undefined,
    ]);
  });

  it("keeps one row for a shield or unshield both histories have", () => {
    const shield = entry(B, 2517213);

    /** @type {ActivityRow[]} */
    const shielded = [
      {
        hash: shield.hash.toUpperCase(),
        kind: "shield",
        privacy: "shielded",
        source: "shielded",
        status: "executed",
      },
    ];
    const rows = mergeActivity({ history: [shield], shielded });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "shield",
      privacy: "public",
      source: "archive",
    });
  });

  it("sorts entries not looked up yet by the time their height gives", () => {
    const later = {
      ...received(),
      blockHeight: 4_687_000,
      detailsAt: undefined,
      hash: "dd".repeat(32),
      timestamp: null,
    };
    const rows = mergeActivity({
      estimateTime: (h) => 1_792_979_099_000 - (4_687_170 - h) * 10_000,
      history: [received(), later],
      local: [
        {
          hash: "ee".repeat(32),
          status: "submitted",
          submittedAt: 1_792_000_000_000,
        },
      ],
    });

    expect(rows.map((r) => r.hash.slice(0, 2))).toEqual([
      "dd",
      received().hash.slice(0, 2),
      "ee",
    ]);
  });
});
