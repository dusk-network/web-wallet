import { afterAll, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { Network } from "@dusk/w3sper";

import SendingNetwork, { broadcastsAsked } from "../SendingNetwork";
import { SendCancelledError, sendGate } from "../sendGate";
import { cancelWaitingSends, keepWaiting, waitingSends } from "../waitingSends";
import describeFailure from "../describeFailure";

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

describe("The sends waiting to go out", () => {
  it("lists one until it goes out, is called off or ends, and calls off every one there is as the wallet locks", async () => {
    /** @param {Promise<unknown>} operation */
    const waiting = (operation, what = "0.01 DUSK to Profile 2") => {
      const gate = sendGate();

      keepWaiting({ gate, operation, what });

      return gate;
    };
    const whats = () => get(waitingSends).map(({ what }) => what);

    // Handed over: it's on its way, no longer waiting.
    const out = waiting(new Promise(() => {}));

    expect(whats()).toStrictEqual(["0.01 DUSK to Profile 2"]);

    out.handOver();

    expect(whats()).toStrictEqual([]);

    // Called off from the list.
    waiting(new Promise(() => {}), "0.02 DUSK to Profile 2");
    get(waitingSends)[0].cancel();

    expect(whats()).toStrictEqual([]);

    // Ended, as it failed with nothing sent.
    const failing = Promise.withResolvers();

    waiting(failing.promise, "0.03 DUSK to Profile 2");
    failing.reject(new TypeError("Failed to fetch"));
    await failing.promise.catch(() => {});
    await Promise.resolve();

    expect(whats()).toStrictEqual([]);

    // The wallet locks: each called off.
    const one = waiting(new Promise(() => {}), "0.04 DUSK to Profile 2");
    const two = waiting(new Promise(() => {}), "0.05 DUSK to Profile 2");

    cancelWaitingSends(new Error("The wallet changed meanwhile"));

    expect(whats()).toStrictEqual([]);
    expect([get(one), get(two)]).toStrictEqual(["cancelled", "cancelled"]);
    // Called off for the lock, it says that, not that it was cancelled.
    await expect(one.cancelled).rejects.toThrow("The wallet changed meanwhile");
    expect(() => one.check()).toThrow("The wallet changed meanwhile");
  });
});
