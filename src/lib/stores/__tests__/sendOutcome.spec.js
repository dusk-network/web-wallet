import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { Gas, Network, ProfileGenerator, ShieldTransfer } from "@dusk/w3sper";

import { TransactionResult } from "$lib/components";
import { stubWalletNetwork } from "$lib/test-helpers";
import { generateMnemonic, getSeedFromMnemonic } from "$lib/wallet";
import WalletTreasury from "$lib/wallet-treasury";

import { walletStore } from "..";

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
  async function shieldResult() {
    const rendered = render(TransactionResult, {
      maxFee: 1n,
      operation: walletStore
        .shield(1n, new Gas({ limit: 1n, price: 1n }))
        .then(({ hash }) => hash),
    });

    await vi.waitFor(() =>
      expect(rendered.container.querySelector(".dusk-error-alert")).toBeTruthy()
    );

    const alert = /** @type {HTMLElement} */ (
      rendered.container.querySelector(".dusk-error-alert")
    );

    return {
      heading: alert.querySelector(".dusk-error-alert__summary")?.textContent,
      sentence: alert.querySelector(".dusk-error-alert__description")
        ?.textContent,
      text: rendered.container.textContent ?? "",
    };
  }

  it("says to try again before the node was asked to broadcast it, and after, that it may have gone out and to check History, never to send it again", async () => {
    executeUntil("preverify", new TypeError("Failed to fetch"));

    expect(await shieldResult()).toMatchObject({
      heading: "Transaction failed",
      sentence:
        "Couldn't reach the network. Check your connection and try again.",
    });
    cleanup();

    executeUntil("propagate", new TypeError("Failed to fetch"));

    const result = await shieldResult();

    expect(result).toMatchObject({
      heading: "Not confirmed",
      sentence:
        "It may have reached the network. Check History before you send it again.",
    });
    // Nothing on the screen says it failed, or to try again.
    expect(result.text).not.toMatch(/try again|transaction failed/i);
    // What it ran into, under Details.
    expect(result.text).toContain("Failed to fetch");
  });

  it("says the same once it went out and keeping its nonce failed", async () => {
    executeUntil("propagate", null);
    vi.spyOn(
      WalletTreasury.prototype,
      "updateCachedNonce"
    ).mockRejectedValueOnce(new Error("The quota has been exceeded."));

    expect(await shieldResult()).toMatchObject({
      heading: "Not confirmed",
      sentence:
        "It may have reached the network. Check History before you send it again.",
    });
  });
});
