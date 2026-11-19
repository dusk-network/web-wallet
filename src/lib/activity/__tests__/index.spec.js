import { afterEach, describe, expect, it, vi } from "vitest";
import { networks } from "@dusk-network/networks";
import { get } from "svelte/store";

import { noteSozuPool } from "$lib/sozu";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { putLocalTransaction } from "../activityStore";
import { THIS_PAGE } from "../constants";
import fixture from "./fixtures/activity-testnet.json";
import { fakeArchive } from "./fixtures/fakeArchive";
import {
  activityFor,
  activityState,
  currentActivity,
  noteInQueue,
  noteNotSentYet,
  noteSentAccepted,
  noteSentOutcome,
  noteUnconfirmed,
  stopActivity,
} from "..";

const [A, B] = Object.keys(fixture.accounts);
const NODE = fixture.nodeUrl;

/** @param {string} account */
const optionsFor = (account) => ({
  account,
  namesNetwork: "testnet",
  nodeUrl: NODE,
  profileIndex: 0,
});

afterEach(() => {
  stopActivity();
  setNodeNetwork(null);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("activityFor", () => {
  it("keeps one history session, for the account shown, and its state", async () => {
    fakeArchive();

    const first = activityFor(optionsFor(A));

    expect(activityFor(optionsFor(A))).toBe(first);
    await first.start();
    expect(get(activityState).rows.length).toBeGreaterThan(0);

    const listener = vi.fn();

    first.subscribe(listener);
    listener.mockClear();

    const second = activityFor(optionsFor(B));

    expect(second).not.toBe(first);
    expect(currentActivity()).toBe(second);

    // The first one stopped: it tells nobody anything any more.
    await first.refresh();
    expect(listener).not.toHaveBeenCalled();
  });

  it("reads its rows again when Sozu's hub names another pool", async () => {
    // A pool only Sozu's hub names.
    const pool = "5a".repeat(32);
    const sozu = () =>
      get(activityState).rows.find((row) => row.contractId === pool)?.sozu;

    fakeArchive();
    setNodeNetwork(networks.testnet);

    const session = activityFor(optionsFor(A));

    await session.start();
    await session.recordSent({
      amount: "500000000",
      contractId: pool,
      direction: "out",
      fnName: "sozu_stake",
      hash: "ab".repeat(32),
      kind: "contract_call",
      privacy: "public",
    });

    expect(sozu()).toBeNull();

    noteSozuPool(pool);

    expect(sozu()).toBe("stake");
  });

  it("has what the chain said of a send, as the screen that followed it said it, shown for the profile that sent it, also once another profile shows", async () => {
    fakeArchive();

    const hash = "5e".repeat(32);
    const rowOf = () =>
      get(activityState).rows.find((row) => row.hash === hash);
    const sender = activityFor(optionsFor(B));

    await sender.start();
    await sender.recordSent({
      amount: "20000000",
      direction: "out",
      hash,
      kind: "transfer",
      privacy: "public",
      to: A,
    });

    // Another profile shows as the block takes it.
    await activityFor(optionsFor(A)).start();
    await noteSentOutcome(hash, {
      blockHeight: 4_833_700n,
      error: "Panic: out of gas",
      fee: 2_000_000n,
      timestamp: null,
    });

    expect(rowOf()).toBeUndefined();

    await activityFor(optionsFor(B)).start();

    expect(rowOf()).toMatchObject({
      blockHeight: 4_833_700,
      error: "Panic: out of gas",
      fee: 2_000_000n,
      status: "failed",
    });
  });

  // Marek's: a send whose answer never came was "Sent · Pending" until
  // another send proved it never went out.
  it("says a send whose answer never came isn't confirmed yet, until the chain says what became of it, and never over what it said", async () => {
    fakeArchive();

    const hash = "6f".repeat(32);
    const rowOf = () =>
      get(activityState).rows.find((row) => row.hash === hash);
    const sender = activityFor(optionsFor(B));

    await sender.start();
    await sender.recordSent({
      amount: "20000000",
      direction: "out",
      hash,
      kind: "transfer",
      privacy: "public",
      to: A,
    });

    expect(rowOf()).toMatchObject({ status: "pending" });

    await noteUnconfirmed(hash);

    expect(rowOf()).toMatchObject({ status: "unknown" });

    // The chain has it: that's what's said, and stays said.
    await noteSentOutcome(hash, {
      blockHeight: 4_833_701n,
      error: null,
      fee: 1_000_000n,
      timestamp: null,
    });
    await noteUnconfirmed(hash);

    expect(rowOf()).toMatchObject({
      blockHeight: 4_833_701,
      status: "executed",
    });
  });

  // Chen's, on hospital Wi-Fi: "Sent · Pending" while the hand-over hung,
  // though the node never got it.
  it("shows a send only once the node took it: never while its broadcast isn't answered, nor while the node doesn't have it, its nonce free", async () => {
    fakeArchive();

    const hash = "7e".repeat(32);
    const rowOf = () =>
      get(activityState).rows.find((row) => row.hash === hash);
    const sender = activityFor(optionsFor(B));

    await sender.start();
    await sender.recordSent(
      {
        amount: "20000000",
        direction: "out",
        hash,
        kind: "transfer",
        privacy: "public",
        to: A,
      },
      { handing: true },
    );

    // Asked to broadcast it, the node hasn't answered: nothing shows.
    expect(rowOf()).toBeUndefined();
    expect(
      (await sender.keptRows()).rows.some((row) => row.hash === hash),
    ).toBe(false);

    // Its answer got lost: not confirmed yet.
    await noteUnconfirmed(hash, { handing: true });

    expect(rowOf()).toMatchObject({ status: "unknown" });

    // The node doesn't have it, its nonce free: nothing shows, nor in a
    // search of all that's kept.
    await noteNotSentYet(hash);

    expect(rowOf()).toBeUndefined();
    expect(
      (await sender.keptRows()).rows.some((row) => row.hash === hash),
    ).toBe(false);

    // Sent again as it is, the node took it: sent, on its way.
    await noteSentAccepted(hash);

    expect(rowOf()).toMatchObject({ direction: "out", status: "pending" });

    // In its mempool: on its way, still.
    await noteInQueue(hash);

    expect(rowOf()).toMatchObject({ status: "pending" });
  });

  // Astra's: a page that went before the node answered left its send, or
  // its stake, unseen in History for good, though it may have gone out.
  it("says what a page handed to the node and went before it answered isn't confirmed yet, as History opens again: never one the node doesn't have, nor one this page is handing over", async () => {
    fakeArchive();

    const first = activityFor(optionsFor(B));
    const { ownerKey } = first;
    /**
     * Kept unseen, as handed over by `handing`, or as one the node doesn't
     * have where there's none.
     *
     * @param {string} hash
     * @param {ActivityKind} kind
     * @param {string} [handing]
     */
    const keepUnseen = (hash, kind, handing) =>
      putLocalTransaction(ownerKey, {
        amount: "20000000",
        direction: "out",
        hash,
        kind,
        privacy: "public",
        status: "removed",
        submittedAt: Date.now(),
        to: A,
        ...(handing ? { handing } : {}),
      });
    const sendGone = "71".repeat(32);
    const stakeGone = "72".repeat(32);
    const notHad = "73".repeat(32);
    const handedHere = "74".repeat(32);

    await first.start();
    await keepUnseen(sendGone, "transfer", "a page gone");
    await keepUnseen(stakeGone, "stake", "a page gone");
    await keepUnseen(notHad, "transfer");
    await keepUnseen(handedHere, "transfer", THIS_PAGE);

    // History opens again.
    stopActivity();
    await activityFor(optionsFor(B)).start();

    const rowOf = (/** @type {string} */ hash) =>
      get(activityState).rows.find((row) => row.hash === hash);

    expect(rowOf(sendGone)).toMatchObject({ status: "unknown" });
    expect(rowOf(stakeGone)).toMatchObject({ status: "unknown" });
    expect(rowOf(notHad)).toBeUndefined();
    expect(rowOf(handedHere)).toBeUndefined();

    // Once the node says it doesn't have one, it's not shown again, nor
    // said not confirmed the next time History opens.
    await noteNotSentYet(sendGone);
    stopActivity();
    await activityFor(optionsFor(B)).start();

    expect(rowOf(sendGone)).toBeUndefined();
  });

  it("forgets the session and its rows when stopped, as for a lock", async () => {
    fakeArchive();
    await activityFor(optionsFor(A)).start();

    stopActivity();

    expect(currentActivity()).toBeNull();
    expect(get(activityState)).toMatchObject({ loaded: false, rows: [] });
  });
});
