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
import {
  Bookkeeper,
  Gas,
  Network,
  ProfileGenerator,
  ShieldTransfer,
  Transfer,
} from "@dusk/w3sper";
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

  // The wallet's sync as it is, before a test stands in for it.
  const treasuryUpdate = WalletTreasury.prototype.update;

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
      heading: "Not sent",
      icon: mdiCloseThick,
      links: [["Home", "/some-base-path/dashboard"]],
      offersRetry: true,
      sentence:
        "Couldn't reach the network. Nothing was sent and no fee was charged.",
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

    /** The send waiting on the node, given its answer at last: it failed. */
    let answer = () => {};

    /** The send waiting, settled. */
    let settled = Promise.resolve();

    /**
     * w3sper's execute, waiting on the node from the step given on, until
     * `answer`.
     *
     * @param {"build" | "propagate"} step
     */
    const waitFrom = (step) =>
      executeSpy.mockImplementationOnce(
        /** @this {any} */
        async function (/** @type {any} */ tx) {
          const answered = new Promise((_, reject) => {
            answer = () => reject(new TypeError("Failed to fetch"));
          });
          const transaction = await tx.build(this);

          if (step === "propagate") {
            await this.transactions.preverify(transaction.buffer);
            void this.transactions.propagate(transaction.buffer);
          }

          return answered;
        }
      );
    const waiting = () => {
      const operation = walletStore.shield(
        1n,
        new Gas({ limit: 1n, price: 1n })
      );

      settled = operation.then(
        () => {},
        () => {}
      );

      return render(TransactionResult, {
        maxFee: 1n,
        operation: operation.then(({ hash }) => hash),
      });
    };

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
      // It's over before the next goes out, in its turn.
      await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledOnce());
      answer();
      await settled;

      waitFrom("propagate");
      await act(() => setNetworkReach("silent"));

      const after = waiting();

      await vi.waitFor(() =>
        expect(after.getByRole("status")).toHaveTextContent(
          "The network isn't answering. Your transaction may have reached it: wait for it here before you send it again."
        )
      );
    } finally {
      answer();
      await settled;
      setNetworkReach("answering");
    }
  });

  it("calls off a send that waits, at once, says nothing was sent, offers Cancel and Home while the network doesn't answer, and never sends it, though the network answers after", async () => {
    const { SendCancelledError, sendGate } = await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");
    const synced = Promise.withResolvers();
    const update = vi
      .spyOn(WalletTreasury.prototype, "update")
      .mockImplementationOnce(() => synced.promise);
    const gate = sendGate();
    const sending = walletStore.transfer(
      "someone",
      1n,
      "",
      new Gas({ limit: 1n, price: 1n }),
      { gate }
    );
    const rendered = render(TransactionResult, {
      gate,
      maxFee: 1n,
      onRetry: () => {},
      operation: sending.then(({ hash }) => hash),
    });

    sending.catch(() => {});
    await vi.waitFor(() => expect(update).toHaveBeenCalled());

    try {
      await act(() => setNetworkReach("silent"));

      expect(rendered.getByRole("status")).toHaveTextContent(
        "The network isn't answering. Nothing has left your wallet yet. It goes out once the network answers."
      );
      expect(rendered.getByRole("link", { name: "Home" })).toBeInTheDocument();

      // Cancel: it stops at once, with nothing sent.
      await act(() => rendered.getByRole("button", { name: "Cancel" }).click());

      await expect(sending).rejects.toBeInstanceOf(SendCancelledError);
      await vi.waitFor(() =>
        expect(shown(rendered.container)).toMatchObject({
          heading: "Not sent",
          sentence: "You cancelled it, so nothing was sent.",
        })
      );
      expect(
        rendered.getByRole("button", { name: "Try again" })
      ).toBeInTheDocument();

      // The network answers after all: nothing goes to it.
      synced.resolve(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      setNetworkReach("answering");
    }
  });

  /** A transfer that can be called off, as Send makes it, and its result screen. */
  async function gatedTransfer() {
    const { sendGate } = await import("$lib/transactions");
    const gate = sendGate();
    const sending = walletStore.transfer(
      String(get(walletStore).profiles[0].account),
      1n,
      "",
      new Gas({ limit: 1n, price: 1n }),
      { gate }
    );
    const rendered = render(TransactionResult, {
      gate,
      maxFee: 1n,
      onRetry: () => {},
      operation: sending.then(({ hash }) => hash),
    });

    sending.catch(() => {});

    return { gate, rendered, sending };
  }

  /** The browser says it's back online. */
  const backOnline = () => act(() => window.dispatchEvent(new Event("online")));

  it("waits for the network where a send that can still be called off couldn't reach it, offline, says so with Cancel and Home, and sends it once, once the network answers", async () => {
    const { broadcastsAsked } = await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");
    const asked = get(broadcastsAsked);
    const offline = () => Promise.reject(new TypeError("Failed to fetch"));
    // Offline: the sync can't reach the node, and nor can the network be asked.
    const update = vi
      .spyOn(WalletTreasury.prototype, "update")
      .mockImplementationOnce(offline);
    const answers = vi
      .spyOn(networkStore, "getCurrentBlockHeight")
      .mockImplementation(offline);
    const synced = update.mock.calls.length;
    const askedNetwork = answers.mock.calls.length;
    // Each time it's made, a transaction of its own.
    const toBuild = vi.spyOn(Transfer.prototype, "to").mockImplementation(
      () =>
        /** @type {any} */ ({
          build: async () => ({
            buffer: new Uint8Array([4, 5, 6]),
            hash: "cd".repeat(32),
            nonce: 2n,
          }),
          gas() {
            return this;
          },
          memo() {
            return this;
          },
        })
    );

    // Still offline as the node is asked to check it, then back.
    executeUntil("preverify", new TypeError("Failed to fetch"));
    executeUntil("propagate", null);
    await act(() => setNetworkReach("offline"));

    try {
      const { gate, rendered } = await gatedTransfer();

      await vi.waitFor(() => expect(get(gate.waitsForNetwork)).toBe(true));

      const waiting = () => {
        expect(rendered.getByRole("status")).toHaveTextContent(
          "You're offline. Nothing has left your wallet yet. It goes out once the network answers."
        );
        expect(
          rendered.getByRole("button", { name: "Cancel" })
        ).toBeInTheDocument();
        expect(rendered.getByRole("link", { name: "Home" })).toHaveAttribute(
          "href",
          "/some-base-path/dashboard"
        );
        expect(rendered.container).not.toHaveTextContent(
          /not sent|failed|try again/i
        );
      };

      waiting();

      // Asked as the browser says it's back, the network doesn't answer yet.
      await backOnline();
      await vi.waitFor(() =>
        expect(answers.mock.calls.length - askedNetwork).toBe(1)
      );
      waiting();
      expect(executeSpy).not.toHaveBeenCalled();

      // It answers: it's made again, and is still offline as the node is
      // asked to check it, so it waits once more.
      answers.mockResolvedValue(123n);
      await backOnline();
      await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
      expect(answers.mock.calls.length - askedNetwork).toBe(2);
      await vi.waitFor(() => expect(get(gate.waitsForNetwork)).toBe(true));
      waiting();

      // Back for good: it goes out once, and is followed.
      follow.spy?.mockReturnValueOnce(new Promise(() => {}));
      await act(() => setNetworkReach("answering"));
      await backOnline();

      await vi.waitFor(() =>
        expect(
          rendered.container.querySelector(".transaction-status")
        ).toBeTruthy()
      );
      expect(executeSpy).toHaveBeenCalledTimes(2);
      expect(update.mock.calls.length - synced).toBe(3);
      expect(get(broadcastsAsked)).toBe(asked + 1);
      expect(get(gate)).toBe("handed-over");
      expect(get(gate.waitsForNetwork)).toBe(false);
      expect(shown(rendered.container).heading).toBe("Sending…");
    } finally {
      setNetworkReach("answering");
      answers.mockResolvedValue(123n);
      toBuild.mockRestore();
    }
  });

  it("sends two that waited for the network one after the other as it answers, each with a nonce of its own", async () => {
    const { broadcastsAsked, sendGate } = await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");
    const asked = get(broadcastsAsked);
    let isOffline = true;
    /** @type {any} */
    let treasury = null;
    const update = vi
      .spyOn(WalletTreasury.prototype, "update")
      .mockImplementation(
        /** @this {any} */
        function (/** @type {any[]} */ ...args) {
          treasury = this;

          return isOffline
            ? Promise.reject(new TypeError("Failed to fetch"))
            : treasuryUpdate.apply(this, /** @type {any} */ (args));
        }
      );
    const answers = vi
      .spyOn(networkStore, "getCurrentBlockHeight")
      .mockImplementation(() =>
        isOffline
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve(123n)
      );
    // The public balance's nonce, as the wallet reads it: the treasury's,
    // with the one its last send took.
    const balance = vi
      .spyOn(Bookkeeper.prototype, "balance")
      .mockImplementation(async (identifier) =>
        ProfileGenerator.typeOf(String(identifier)) === "address"
          ? /** @type {any} */ ({ spendable: 0n, value: 0n })
          : treasury.account(identifier)
      );
    /** @type {bigint[]} */
    const nonces = [];
    let made = 0;
    const realTo = Transfer.prototype.to;
    // As w3sper builds a transfer, but for its proof: the nonce after the
    // one the wallet reads.
    const build = vi.spyOn(Transfer.prototype, "to").mockImplementation(
      /** @this {any} */
      function (/** @type {any} */ value) {
        const builder = /** @type {any} */ (realTo.call(this, value));

        builder.build = async () => {
          const { nonce } = await builder.bookentry.info.balance("account");

          made += 1;
          nonces.push(nonce + 1n);

          return {
            buffer: new Uint8Array([8, made]),
            hash: String(made).repeat(64).slice(0, 64),
            nonce: nonce + 1n,
          };
        };

        return builder;
      }
    );

    executeUntil("propagate", null);
    executeUntil("propagate", null);
    await act(() => setNetworkReach("offline"));

    try {
      const to = String(get(walletStore).profiles[1].account);
      const gates = [sendGate(), sendGate()];
      const sends = gates.map((gate) =>
        walletStore.transfer(to, 1n, "", new Gas({ limit: 1n, price: 1n }), {
          gate,
        })
      );

      sends.forEach((send) => send.catch(() => {}));
      await vi.waitFor(() =>
        expect(gates.map((gate) => get(gate.waitsForNetwork))).toEqual([
          true,
          true,
        ])
      );

      // Back: the one moment the network answers ends both waits.
      isOffline = false;
      await act(() => setNetworkReach("answering"));
      await act(() => window.dispatchEvent(new Event("online")));
      await Promise.allSettled(sends);

      expect(get(broadcastsAsked)).toBe(asked + 2);
      // The node takes one transaction a nonce: each its own.
      expect(new Set(nonces).size).toBe(2);
    } finally {
      isOffline = false;
      setNetworkReach("answering");
      update.mockRestore();
      answers.mockResolvedValue(123n);
      balance.mockResolvedValue(
        /** @type {any} */ ({ nonce: 0n, spendable: 0n, value: 0n })
      );
      build.mockRestore();
    }
  });

  it("sends the next once one waiting on the node before it was handed over is called off", async () => {
    const { SendCancelledError, broadcastsAsked, sendGate } =
      await import("$lib/transactions");
    const asked = get(broadcastsAsked);
    const to = String(get(walletStore).profiles[1].account);
    const gas = new Gas({ limit: 1n, price: 1n });
    const toBuild = vi.spyOn(Transfer.prototype, "to").mockImplementation(
      () =>
        /** @type {any} */ ({
          build: async () => ({
            buffer: new Uint8Array([9, 9]),
            hash: "ef".repeat(32),
            nonce: 3n,
          }),
          gas() {
            return this;
          },
          memo() {
            return this;
          },
        })
    );

    // The node never answers the first as it's checked.
    executeSpy.mockImplementationOnce(() => new Promise(() => {}));
    executeUntil("propagate", null);

    try {
      const gate = sendGate();
      const first = walletStore.transfer(to, 1n, "", gas, { gate });

      await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledOnce());
      gate.cancel();
      await expect(first).rejects.toBeInstanceOf(SendCancelledError);

      // It never reaches the node: the next goes out in its place.
      await expect(
        walletStore.transfer(to, 1n, "", gas, { gate: sendGate() })
      ).resolves.toMatchObject({ hash: "ef".repeat(32) });
      expect(get(broadcastsAsked)).toBe(asked + 1);
    } finally {
      toBuild.mockRestore();
    }
  });

  it("calls off a send that waits for the network it couldn't reach, at once, and never sends it, though the network answers after", async () => {
    const { SendCancelledError } = await import("$lib/transactions");
    const { setNetworkReach } = await import("$lib/stores/networkReach");

    vi.spyOn(WalletTreasury.prototype, "update").mockRejectedValueOnce(
      new TypeError("Failed to fetch")
    );
    await act(() => setNetworkReach("offline"));

    try {
      const { gate, rendered, sending } = await gatedTransfer();

      await vi.waitFor(() => expect(get(gate.waitsForNetwork)).toBe(true));
      await act(() => rendered.getByRole("button", { name: "Cancel" }).click());

      await expect(sending).rejects.toBeInstanceOf(SendCancelledError);
      await vi.waitFor(() =>
        expect(shown(rendered.container)).toMatchObject({
          heading: "Not sent",
          offersRetry: true,
          sentence: "You cancelled it, so nothing was sent.",
        })
      );

      // Back, and the network answers: nothing goes to it.
      await act(() => setNetworkReach("answering"));
      await backOnline();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(executeSpy).not.toHaveBeenCalled();
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

  it("sends for the wallet opened next at once, though a send of the one open before still waits on the node", async () => {
    const { broadcastsAsked } = await import("$lib/transactions");
    const asked = get(broadcastsAsked);
    const gas = new Gas({ limit: 1n, price: 1n });

    // The node never answers it as it's checked.
    executeSpy.mockImplementationOnce(() => new Promise(() => {}));
    walletStore.shield(1n, gas).catch(() => {});
    await vi.waitFor(() => expect(executeSpy).toHaveBeenCalledOnce());

    // Locked, and a wallet opened: none of the one before's sends waits
    // ahead of its own.
    await walletStore.init(
      new ProfileGenerator(async () => getSeedFromMnemonic(generateMnemonic()))
    );
    await vi.waitUntil(() => !get(walletStore).syncStatus.isInProgress);
    executeUntil("propagate", null);

    await expect(walletStore.shield(1n, gas)).resolves.toMatchObject({
      hash: built.hash,
    });
    expect(get(broadcastsAsked)).toBe(asked + 1);
  });
});
