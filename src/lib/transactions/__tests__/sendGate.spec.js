import { afterAll, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { Network } from "@dusk/w3sper";

import SendingNetwork, { broadcastsAsked } from "../SendingNetwork";
import { SendCancelledError, sendGate } from "../sendGate";
import {
  cancelWaitingSends,
  keepWaiting,
  waitingSends,
  waitingText,
} from "../waitingSends";
import describeFailure from "../describeFailure";
import { BALANCE_MASK } from "$lib/constants";

/** A transaction's builder, as w3sper's: what it builds, by its bytes. */
const builder = () => ({
  build: async () => ({ buffer: new Uint8Array([7]), hash: "ab".repeat(32) }),
});

describe("A send that can be called off", () => {
  // w3sper's execute: built, checked by the node, then broadcast.
  const execute = vi.spyOn(Network.prototype, "execute").mockImplementation(
    /** @this {any} */
    async function (/** @type {any} */ tx) {
      const transaction = await tx.build(this);

      await this.transactions.preverify(transaction.buffer);
      await this.transactions.propagate(transaction.buffer);

      return transaction;
    }
  );

  afterAll(() => execute.mockRestore());

  it("is called off, or handed over, whichever comes first, never both", () => {
    const off = sendGate();

    expect(off.cancel()).toBe(true);
    expect(() => off.handOver()).toThrow(SendCancelledError);
    expect(get(off)).toBe("cancelled");

    const out = sendGate();

    out.handOver();

    expect(out.cancel()).toBe(false);
    expect(get(out)).toBe("handed-over");
  });

  it("never reaches the node once called off, though what it waited on answers after, and says nothing went out", async () => {
    const network = new SendingNetwork(new URL("https://nodes.example/"));
    const answer = Promise.withResolvers();
    const asked = get(broadcastsAsked);
    const gate = sendGate();

    // The node's check of it doesn't answer, as on Wi-Fi that loads nothing.
    vi.spyOn(network.transactions, "preverify").mockImplementation(
      () => answer.promise
    );

    const sent = network.execute(/** @type {any} */ (builder()), { gate });

    sent.catch(() => {});
    await vi.waitFor(() =>
      expect(network.transactions.preverify).toHaveBeenCalled()
    );

    expect(gate.cancel()).toBe(true);

    // It answers after all: nothing goes out.
    answer.resolve(undefined);

    await expect(sent).rejects.toBeInstanceOf(SendCancelledError);
    expect(get(broadcastsAsked)).toBe(asked);

    const said = describeFailure(new SendCancelledError());

    expect(said).toMatchObject({
      canRetry: true,
      heading: "Not sent",
      sentence: "You cancelled it, so nothing was sent.",
    });
  });

  it("is broadcast only once what's kept of it says it's handed over, with its hash and nonce, and never where that can't be", async () => {
    const network = new SendingNetwork(new URL("https://nodes.example/"));
    const asked = get(broadcastsAsked);
    const kept = Promise.withResolvers();
    const keep = vi.fn(() => kept.promise);
    const gate = sendGate();

    gate.keepFirst(keep);

    const sent = network.execute(
      /** @type {any} */ ({
        build: async () => ({
          buffer: new Uint8Array([7]),
          hash: "ab".repeat(32),
          nonce: 107n,
        }),
      }),
      { gate }
    );

    await vi.waitFor(() =>
      expect(keep).toHaveBeenCalledWith({ hash: "ab".repeat(32), nonce: "107" })
    );

    // It can't be called off now, and isn't broadcast until it's kept.
    expect(get(gate)).toBe("handed-over");
    expect(gate.cancel()).toBe(false);
    expect(get(broadcastsAsked)).toBe(asked);

    kept.resolve(undefined);
    await sent;

    expect(get(broadcastsAsked)).toBe(asked + 1);

    // Where it can't be kept as handed over, it never goes, and nothing went
    // out: it can be tried again.
    const refused = sendGate();

    refused.keepFirst(() => Promise.reject(new Error("QuotaExceededError")));

    const error = await network
      .execute(/** @type {any} */ (builder()), { gate: refused })
      .catch((/** @type {unknown} */ reason) => reason);

    expect(error).toEqual(new Error("QuotaExceededError"));
    expect(get(broadcastsAsked)).toBe(asked + 1);
    expect(describeFailure(/** @type {Error} */ (error))).toMatchObject({
      canRetry: true,
    });
  });

  it("goes out as ever, past calling off, once the node was asked to broadcast it", async () => {
    const network = new SendingNetwork(new URL("https://nodes.example/"));
    const asked = get(broadcastsAsked);
    const gate = sendGate();

    await network.execute(/** @type {any} */ (builder()), { gate });

    expect(get(broadcastsAsked)).toBe(asked + 1);
    expect(get(gate)).toBe("handed-over");
    expect(gate.cancel()).toBe(false);
  });
});

describe("A send that couldn't reach the network before it went out", () => {
  /** The browser says it's back online. */
  const backOnline = () => window.dispatchEvent(new Event("online"));

  /** What the network is asked, answered as each call says. */
  const asking = () =>
    vi.fn((/** @type {AbortSignal} */ signal) => {
      void signal;

      return Promise.resolve(1n);
    });

  it("waits for the network while it can be called off, is made again once the network answers, and goes out once", async () => {
    const gate = sendGate();
    const answers = asking().mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );
    /** Whether it said it waits for the network as it was made again. */
    let waitedAsMade = true;
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(async () => {
        waitedAsMade = get(gate.waitsForNetwork);
        gate.handOver();

        return "sent";
      });
    const sent = gate.untilHandedOver(attempt, answers);

    await vi.waitFor(() => expect(get(gate.waitsForNetwork)).toBe(true));
    expect(get(gate)).toBe("open");

    // Back online, the network doesn't answer yet: it waits on.
    backOnline();
    await vi.waitFor(() => expect(answers).toHaveBeenCalledTimes(1));
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(get(gate.waitsForNetwork)).toBe(true);

    // It answers: made again, it goes out.
    backOnline();

    await expect(sent).resolves.toBe("sent");
    expect(attempt).toHaveBeenCalledTimes(2);
    // Made again once the network answered: no longer said to wait for it.
    expect(waitedAsMade).toBe(false);
    expect(get(gate)).toBe("handed-over");
    expect(get(gate.waitsForNetwork)).toBe(false);
  });

  it("fails at once for anything but the network, and once it was handed over, never made again", async () => {
    const answers = asking();
    const refused = sendGate();

    await expect(
      refused.untilHandedOver(
        () =>
          Promise.reject(
            new Error("Tx ab not accepted: gas price lower than minimum 1")
          ),
        answers
      )
    ).rejects.toThrow("gas price lower than minimum");

    const out = sendGate();
    const attempt = vi.fn(async () => {
      out.handOver();

      throw new TypeError("Failed to fetch");
    });

    await expect(out.untilHandedOver(attempt, answers)).rejects.toThrow(
      "Failed to fetch"
    );
    expect(attempt).toHaveBeenCalledOnce();
    expect(answers).not.toHaveBeenCalled();
    expect(get(refused.waitsForNetwork)).toBe(false);
  });

  it("stops at once as it's called off while it waits, and asks nothing more", async () => {
    const gate = sendGate();
    const answers = asking();
    const attempt = vi.fn(() =>
      Promise.reject(new TypeError("Failed to fetch"))
    );
    const sent = gate.untilHandedOver(attempt, answers);

    await vi.waitFor(() => expect(get(gate.waitsForNetwork)).toBe(true));
    gate.cancel();

    await expect(sent).rejects.toBeInstanceOf(SendCancelledError);
    expect(get(gate.waitsForNetwork)).toBe(false);

    backOnline();
    await Promise.resolve();

    expect(answers).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledOnce();
  });
});

describe("The sends waiting to go out", () => {
  it("lists one until it goes out, is called off or ends, and calls off every one there is as the wallet locks", async () => {
    /**
     * @param {Promise<unknown>} operation
     * @param {bigint} [lux]
     */
    const waiting = (operation, lux = 10_000_000n) => {
      const gate = sendGate();

      keepWaiting({ gate, lux, operation, to: "Profile 2" });

      return gate;
    };
    const whats = () =>
      get(waitingSends).map((send) =>
        waitingText(send, { hidden: false, locale: "en" })
      );

    // Handed over: it's on its way, no longer waiting.
    const out = waiting(new Promise(() => {}));

    expect(whats()).toStrictEqual(["0.01 DUSK to Profile 2"]);

    out.handOver();

    expect(whats()).toStrictEqual([]);

    // Called off from the list.
    waiting(new Promise(() => {}), 20_000_000n);
    get(waitingSends)[0].cancel();

    expect(whats()).toStrictEqual([]);

    // Ended, as it failed with nothing sent.
    const failing = Promise.withResolvers();

    waiting(failing.promise, 30_000_000n);
    failing.reject(new TypeError("Failed to fetch"));
    await failing.promise.catch(() => {});
    await Promise.resolve();

    expect(whats()).toStrictEqual([]);

    // The wallet locks: each called off.
    const one = waiting(new Promise(() => {}), 40_000_000n);
    const two = waiting(new Promise(() => {}), 50_000_000n);

    cancelWaitingSends(new Error("The wallet changed meanwhile"));

    expect(whats()).toStrictEqual([]);
    expect([get(one), get(two)]).toStrictEqual(["cancelled", "cancelled"]);
    // Called off for the lock, it says that, not that it was cancelled.
    await expect(one.cancelled).rejects.toThrow("The wallet changed meanwhile");
    expect(() => one.check()).toThrow("The wallet changed meanwhile");
  });

  it("says what one sends as balances are shown now, not as they were when it was sent: its amount hidden while they're hidden", () => {
    const send = { lux: 10_000_000n, to: "your Profile 2" };

    expect(waitingText(send, { hidden: false, locale: "en" })).toBe(
      "0.01 DUSK to your Profile 2"
    );
    expect(waitingText(send, { hidden: true, locale: "en" })).toBe(
      `${BALANCE_MASK} DUSK to your Profile 2`
    );
    expect(waitingText(send, { hidden: false, locale: "de" })).toBe(
      "0,01 DUSK to your Profile 2"
    );
  });
});
