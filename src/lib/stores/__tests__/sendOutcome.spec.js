import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, cleanup, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { Gas, Network, ProfileGenerator, ShieldTransfer } from "@dusk/w3sper";
import { mdiCloseThick, mdiTimerSand } from "@mdi/js";

import { TransactionResult } from "$lib/components";
import { timeLabel } from "$lib/activity/present";
import { stubWalletNetwork } from "$lib/test-helpers";
import { generateMnemonic, getSeedFromMnemonic } from "$lib/wallet";
import WalletTreasury from "$lib/wallet-treasury";

import { networkStore, walletStore } from "..";

// Following what went out asks the node, unless a test says what it finds.
const follow = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<(hash: string) => Promise<any>> | null} */
  spy: null,
}));

vi.mock("$lib/transactions/followTransaction", async (importOriginal) => {
  /** @type {typeof import("$lib/transactions/followTransaction")} */
  const original = await importOriginal();

  follow.spy = vi.fn(original.default);

  return { ...original, default: follow.spy };
});

/**
 * Sends that fail on the way to the node: before it was asked to broadcast
 * the transaction nothing went out, and the screen says to try again; once
 * it was, it may have, and nothing says to send it again.
 */
describe("A send that fails", () => {
  stubWalletNetwork();
  vi.stubEnv("VITE_FEATURE_TRANSACTION_HISTORY", "false");

  // The transaction a shield builds, as w3sper gives it.
  const built = {
    buffer: new Uint8Array([1, 2, 3]),
    hash: "ab".repeat(32),
    nonce: 1n,
  };

  const executeSpy = vi.spyOn(Network.prototype, "execute");

  vi.spyOn(ShieldTransfer.prototype, "build").mockImplementation(
    async () => /** @type {any} */ (built)
  );

  beforeAll(async () => {
    const seed = getSeedFromMnemonic(generateMnemonic());

    await walletStore.init(new ProfileGenerator(async () => seed));
    await vi.waitUntil(() => !get(walletStore).syncStatus.isInProgress);
  });

  afterEach(() => {
    cleanup();
    executeSpy.mockReset();
    follow.spy?.mockClear();
  });

  afterAll(() => {
    walletStore.reset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /**
   * w3sper's execute, as far as the step given: the node asked to check
   * the transaction (preverify), or to broadcast it too (propagate).
   *
   * @param {"preverify" | "propagate"} step
   * @param {Error | null} failure What comes back after it; none: it went out
   */
  const executeUntil = (step, failure) =>
    executeSpy.mockImplementationOnce(
      /** @this {any} */
      async function (/** @type {any} */ tx) {
        const transaction = await tx.build(this);

        await this.transactions.preverify(transaction.buffer);

        if (step === "propagate") {
          await this.transactions.propagate(transaction.buffer);
        }

        if (failure) {
          throw failure;
        }

        return transaction;
      }
    );

  /** The result screen of a shield, as the send goes. */
  async function shieldResult(hasHistory = true) {
    const rendered = render(TransactionResult, {
      hasHistory,
      maxFee: 1n,
      onRetry: () => {},
      operation: walletStore
        .shield(1n, new Gas({ limit: 1n, price: 1n }))
        .then(({ hash }) => hash),
    });

    await vi.waitFor(() =>
      expect(
        rendered.container.querySelector(
          ".dusk-error-alert, .transaction-status"
        )
      ).toBeTruthy()
    );

    return { rendered, ...shown(rendered.container) };
  }

  /**
   * What the result screen says: a failure, or how the transaction that may
   * have gone out is getting on.
   *
   * @param {HTMLElement} container
   */
  function shown(container) {
    const alert = container.querySelector(".dusk-error-alert");
    const status = container.querySelector(".transaction-status__summary");

    return {
      heading: alert
        ? alert.querySelector(".dusk-error-alert__summary")?.textContent
        : status?.querySelector(".transaction-status__title")?.textContent,
      sentence: alert
        ? alert.querySelector(".dusk-error-alert__description")?.textContent
        : status?.querySelector("p")?.textContent?.replace(/\s+/g, " ").trim(),
      icon: (alert ?? status)?.querySelector("svg path")?.getAttribute("d"),
      links: [...container.querySelectorAll("a")]
        .filter((a) => !a.closest(".transaction-status"))
        .map((a) => [a.textContent?.trim(), a.getAttribute("href")]),
      offersRetry: [...container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Try again"
      ),
      text: container.textContent ?? "",
    };
  }

  it("says to try again before the node was asked to broadcast it, and after, that it may have gone out and to wait for it, never to send it again", async () => {
    executeUntil("preverify", new TypeError("Failed to fetch"));

    expect(await shieldResult()).toMatchObject({
      heading: "Transaction failed",
      icon: mdiCloseThick,
      links: [["Home", "/some-base-path/dashboard"]],
      offersRetry: true,
      sentence:
        "Couldn't reach the network. Check your connection and try again.",
    });
    cleanup();

    executeUntil("propagate", new TypeError("Failed to fetch"));

    const result = await shieldResult();

    expect(result).toMatchObject({
      heading: "Not confirmed",
      offersRetry: false,
      sentence:
        "It may have reached the network. Wait for it here before you send it again.",
    });
    // Nothing on the screen says it failed, or to try again.
    expect(result.text).not.toMatch(/try again|transaction failed/i);
    // Not a cross: it's the transaction built, followed, and in History.
    expect(result.icon).toBe(mdiTimerSand);
    expect(follow.spy).toHaveBeenCalledWith(built.hash, expect.anything());
    expect(result.links).toStrictEqual([
      [
        "See in History",
        `/some-base-path/dashboard/transactions?tx=${built.hash}`,
      ],
      ["Home", "/some-base-path/dashboard"],
    ]);
  });

  it("says where it waits that the network isn't answering: that nothing left the wallet before the node was asked to broadcast it, and after, to wait for it", async () => {
    const { setNetworkReach } = await import("../networkReach");

    /**
     * w3sper's execute, waiting on the node from the step given on.
     *
     * @param {"build" | "propagate"} step
     */
    const waitFrom = (step) =>
      executeSpy.mockImplementationOnce(
        /** @this {any} */
        async function (/** @type {any} */ tx) {
          const transaction = await tx.build(this);

          if (step === "propagate") {
            await this.transactions.preverify(transaction.buffer);
            void this.transactions.propagate(transaction.buffer);
          }

          return new Promise(() => {});
        }
      );
    const waiting = () =>
      render(TransactionResult, {
        maxFee: 1n,
        operation: walletStore
          .shield(1n, new Gas({ limit: 1n, price: 1n }))
          .then(({ hash }) => hash),
      });

    try {
      waitFrom("build");

      const before = waiting();

      expect(before.getByText("Processing transaction")).toBeInTheDocument();
      expect(before.container).not.toHaveTextContent("isn't answering");

      await act(() => setNetworkReach("silent"));

      expect(before.getByRole("status")).toHaveTextContent(
        "The network isn't answering. Nothing has left your wallet yet."
      );

      await act(() => setNetworkReach("offline"));

      expect(before.getByRole("status")).toHaveTextContent(
        "You're offline. Nothing has left your wallet yet."
      );
      cleanup();

      waitFrom("propagate");
      await act(() => setNetworkReach("silent"));

      const after = waiting();

      await vi.waitFor(() =>
        expect(after.getByRole("status")).toHaveTextContent(
          "The network isn't answering. Your transaction may have reached it: wait for it here before you send it again."
        )
      );
    } finally {
      setNetworkReach("answering");
    }
  });

  it("turns into Sent once the chain has the transaction whose answer got lost, or Failed", async () => {
    const found = Promise.withResolvers();

    executeUntil("propagate", new TypeError("Failed to fetch"));
    follow.spy?.mockReturnValueOnce(found.promise);

    const { rendered } = await shieldResult();
    const at = Date.UTC(2026, 10, 5, 21, 16);

    found.resolve({ blockHeight: 4321n, error: null, fee: 2n, timestamp: at });

    await vi.waitFor(() =>
      expect(shown(rendered.container)).toMatchObject({
        heading: `Sent at ${timeLabel(at, "en", { seconds: true })}`,
        sentence: "In block 4,321.",
      })
    );
    cleanup();

    const failed = Promise.withResolvers();

    executeUntil("propagate", new TypeError("Failed to fetch"));
    follow.spy?.mockReturnValueOnce(failed.promise);

    const second = await shieldResult();

    failed.resolve({
      blockHeight: 4322n,
      error: "Panic: out of gas",
      fee: 2n,
      timestamp: at,
    });

    await vi.waitFor(() =>
      expect(shown(second.rendered.container)).toMatchObject({
        heading: "Failed",
        sentence: "It didn't go through. The network fee was charged.",
      })
    );
  });

  it("says a refusal the node gave as it was asked to broadcast it is one, with the way home", async () => {
    executeUntil(
      "propagate",
      new Error(
        "Tx 4f4f not accepted: this transaction is invalid Value spent larger than account holds"
      )
    );

    expect(await shieldResult()).toMatchObject({
      heading: "Transaction failed",
      icon: mdiCloseThick,
      links: [["Home", "/some-base-path/dashboard"]],
      offersRetry: true,
    });
  });

  it("follows it where there's no History too, and leads Home", async () => {
    executeUntil("propagate", new TypeError("Failed to fetch"));

    expect(await shieldResult(false)).toMatchObject({
      heading: "Not confirmed",
      links: [["Home", "/some-base-path/dashboard"]],
      offersRetry: false,
      sentence:
        "It may have reached the network. Wait for it here before you send it again.",
    });
  });

  it("says the same once it went out and keeping its nonce failed", async () => {
    executeUntil("propagate", null);
    vi.spyOn(
      WalletTreasury.prototype,
      "updateCachedNonce"
    ).mockRejectedValueOnce(new Error("The quota has been exceeded."));

    expect(await shieldResult()).toMatchObject({
      heading: "Not confirmed",
      offersRetry: false,
      sentence:
        "It may have reached the network. Wait for it here before you send it again.",
    });
  });

  it("says the same once it went out and anything else fails after it", async () => {
    executeUntil("propagate", null);

    const { connect } = networkStore;
    let connections = 0;

    // Connecting to send goes as ever: following what went out doesn't.
    const connecting = vi
      .spyOn(networkStore, "connect")
      .mockImplementation(() => {
        connections += 1;

        if (connections > 1) {
          throw new Error("Couldn't follow it.");
        }

        return connect();
      });

    // Not followed, as the node can't be asked: it says so.
    const { rendered } = await shieldResult();

    await vi.waitFor(() =>
      expect(shown(rendered.container)).toMatchObject({
        heading: "Not confirmed",
        offersRetry: false,
        sentence:
          "It isn't in a block yet. See its status in the explorer before you send it again.",
      })
    );

    connecting.mockRestore();
  });
});
