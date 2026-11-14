import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { get } from "svelte/store";
import { formatTime } from "@dusk-network/networks/format";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { keptSendsDatabase } from "$lib/transactions/unsentSends";
import { startIncarnation } from "$lib/wallets/dataNames";

/** What sends, and where the wallet goes: nothing sends here by itself. */
const app = vi.hoisted(() => ({
  goto: vi.fn(() => Promise.resolve()),
  transfer: vi.fn(),
}));

vi.mock("$app/navigation", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  goto: app.goto,
}));

// The wallet open on testnet, whichever page shows it.
vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");
  const { networks } = await import("@dusk-network/networks");
  const { default: wallet } = await import("$lib/mocks/mockedWalletStore");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      subscribe: writable({
        connected: true,
        net: networks.testnet,
        networkName: "testnet",
      }).subscribe,
    },
    walletStore: {
      ...wallet,
      refreshBalance: () => Promise.resolve(),
      setCurrentProfile: () => Promise.resolve(),
      startHistory: () => ({ refresh: () => Promise.resolve() }),
      transfer: app.transfer,
    },
  };
});

vi.mock("$lib/sozu", async (importOriginal) => {
  /** @type {typeof import("$lib/sozu")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  return {
    ...original,
    sozuStore: {
      load: () => Promise.resolve(),
      reset: () => {},
      subscribe: writable({
        account: "",
        available: true,
        error: null,
        loading: false,
        status: null,
      }).subscribe,
    },
  };
});

describe("A send that never went out", () => {
  const { currentProfile, profiles } = mockedWalletStore.getMockedStoreValue();
  const from = String(currentProfile.account);
  const to = String(profiles[1].account);
  const props = { data: { currentPrice: Promise.resolve({}) } };
  const LOCK = `${CONFIG.LOCAL_STORAGE_APP_KEY}-sending:`;

  /** What the pages drawn here leave, to clear after each test. */
  let cleanups = /** @type {Array<() => void>} */ ([]);

  /**
   * A page of the wallet as it loads, after a reload or in another tab:
   * nothing another page holds in memory, and the wallet open, as an unlock
   * opens it. It draws with its own Svelte.
   */
  async function openPage() {
    vi.resetModules();

    const { useWalletData } = await import("$lib/wallets/walletData");
    const testing = await import("@testing-library/svelte");

    useWalletData("");
    cleanups.push(testing.cleanup);

    return {
      Home: (await import("../+page.svelte")).default,
      SendingNetwork: (await import("$lib/transactions/SendingNetwork"))
        .default,
      errors: await import("$lib/errors"),
      fireEvent: testing.fireEvent,
      /** @param {any} Component */
      render: (Component) => testing.render(Component, props),
      toasts: await import("$lib/dusk/components/Toast/store"),
      transactions: await import("$lib/transactions"),
      unsent: await import("$lib/transactions/unsentSends"),
    };
  }

  /**
   * Has the page's locks for sends go as `gone` resolves, as a page's go with
   * it: each a send holds from then on.
   *
   * @param {Promise<unknown>} gone
   * @returns {{ held: Promise<unknown>, restore: () => void }} `held` once
   *   one is held
   */
  function locksGoWith(gone) {
    const request = navigator.locks.request.bind(navigator.locks);
    const held = Promise.withResolvers();
    const locks = vi.spyOn(navigator.locks, "request").mockImplementation(
      /** @type {any} */ (
        (/** @type {string} */ name, /** @type {() => unknown} */ take) =>
          name.startsWith(LOCK)
            ? request(name, () => {
                const holding = take();

                held.resolve(undefined);

                return Promise.race([holding, gone]);
              })
            : request(name, take)
      )
    );

    return { held: held.promise, restore: () => locks.mockRestore() };
  }

  /** What's kept of the sends, as the next page reads it. */
  const keptNow = () => keptSendsDatabase.table("sends").toArray();

  /**
   * Sends 0.01 DUSK to Profile 2 from a page, as Send does, and it waits for
   * the network, until `operation` settles, which `gate` lets go out; the
   * page goes as `gone` resolves, and its locks with it. Resolves once the
   * page holds the send's lock.
   *
   * @param {Awaited<ReturnType<typeof openPage>>} page
   * @param {string} memo
   * @param {Promise<unknown>} gone
   * @param {{ gate?: import("$lib/transactions/sendGate").SendGate, operation?: Promise<unknown> }} [sending]
   */
  async function sendWaiting(
    page,
    memo,
    gone,
    {
      gate = page.transactions.sendGate(),
      operation = new Promise(() => {}),
    } = {}
  ) {
    const locks = locksGoWith(gone);

    page.transactions.keepWaiting({
      address: to,
      from,
      gate,
      kept: {
        account: from,
        isSaid: () => true,
        network: "testnet",
        typed: {
          amount: "0.01",
          isMax: false,
          isOwn: false,
          memo,
          picks: {},
          to,
        },
      },
      lux: 10_000_000n,
      maxFee: 2_500_000n,
      memo,
      operation,
      to: "your Profile 2",
    });

    const [{ at }] = get(page.transactions.waitingSends).slice(-1);

    await locks.held;
    locks.restore();

    return { at, gate };
  }

  /** The hash and the nonce of the transaction sent through the network. */
  const sentTx = { hash: "cd".repeat(32), nonce: 107n };

  /**
   * Sends 0.01 DUSK to Profile 2 from a page, as Send does, through the
   * network as the wallet sends on it, and the page dies at `step`, as a
   * browser does: built, with the node's check of it never answering
   * ("built"); kept as handed over, before the node is asked to broadcast
   * it ("kept"); or once the node was asked to broadcast it, before its
   * answer ("broadcast"). Its locks go as `gone` resolves. Resolves once
   * it's there, and kept as it is then.
   *
   * @param {Awaited<ReturnType<typeof openPage>>} page
   * @param {string} memo
   * @param {Promise<unknown>} gone
   * @param {"broadcast" | "built" | "kept"} step
   */
  async function sendThrough(page, memo, gone, step) {
    const { Network } = await import("@dusk/w3sper");
    const network = new page.SendingNetwork(new URL("https://nodes.example/"));
    const reached = Promise.withResolvers();
    const asked = get(page.transactions.broadcastsAsked);
    // w3sper's execute: built, checked by the node, then broadcast. Nothing
    // after the step it dies at answers.
    const execute = vi.spyOn(Network.prototype, "execute").mockImplementation(
      /** @this {any} */
      async function (/** @type {any} */ tx) {
        const transaction = await tx.build(this);

        if (step === "built") {
          reached.resolve(undefined);

          return new Promise(() => {});
        }

        await this.transactions.preverify(transaction.buffer);
        await this.transactions.propagate(transaction.buffer);
        reached.resolve(undefined);

        return new Promise(() => {});
      }
    );
    const gate = page.transactions.sendGate();

    if (step === "kept") {
      // What's kept of it says so, and the page dies before the broadcast.
      gate.keepFirst(async () => {
        await vi.waitFor(async () =>
          expect(await keptNow()).toContainEqual(
            expect.objectContaining({ handedOver: expect.anything() })
          )
        );
        reached.resolve(undefined);
        await new Promise(() => {});
      });
    }

    try {
      await sendWaiting(page, memo, gone, {
        gate,
        operation: network.execute(
          /** @type {any} */ ({
            build: async () => ({ ...sentTx, buffer: new Uint8Array([7]) }),
          }),
          { gate }
        ),
      });
      await reached.promise;
    } finally {
      execute.mockRestore();
    }

    expect(get(page.transactions.broadcastsAsked)).toBe(
      step === "broadcast" ? asked + 1 : asked
    );
  }

  /** @param {HTMLElement} container */
  const noticesOf = (container) =>
    Array.from(container.querySelectorAll(".unsent-send"), (notice) =>
      notice.textContent?.replace(/\s+/g, " ").trim()
    );

  // Home's code is read once, slowly: each page below runs it anew.
  beforeAll(async () => {
    await import("../+page.svelte");
  }, 60_000);

  beforeEach(async () => {
    localStorage.clear();
    await keptSendsDatabase.table("sends").clear();
    // The wallet as it's set up here.
    startIncarnation("");
  });

  afterEach(() => {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    app.goto.mockClear();
    app.transfer.mockClear();
  });

  afterAll(async () => {
    localStorage.clear();
    await keptSendsDatabase.table("sends").clear();
    vi.doUnmock("$app/navigation");
    vi.doUnmock("$lib/stores");
    vi.doUnmock("$lib/sozu");
  });

  it("is said once the wallet opens again after its page reloaded as it waited for the network: what, to whom, its memo and when, to send now or not, never sent by itself, and still once Send takes it, until it's sent", async () => {
    const reloads = Promise.withResolvers();
    const before = await openPage();
    const { at } = await sendWaiting(before, "tab dropped 1", reloads.promise);

    // It reloads: the page goes as it waits, and the wallet opens again.
    reloads.resolve(undefined);

    const after = await openPage();
    const { container, findByText, getByRole } = after.render(after.Home);

    await findByText("Not sent: 0.01 DUSK to your Profile 2.");

    expect(noticesOf(container)).toStrictEqual([
      `Not sent: 0.01 DUSK to your Profile 2. tab dropped 1 · ${formatTime(at, { locale: "en" })} Nothing left your wallet. Send it now Don't send`,
    ]);
    expect(app.transfer).not.toHaveBeenCalled();

    // Send it now: Send's review, filled in with it, to send it from there.
    await after.fireEvent.click(getByRole("button", { name: "Send it now" }));

    expect(app.goto).toHaveBeenCalledWith(
      expect.stringMatching(/\/dashboard\/send$/)
    );
    expect(app.transfer).not.toHaveBeenCalled();
    expect(
      after.transactions.takeUnsentRefill({ account: from, network: "testnet" })
    ).toMatchObject({
      label: "your Profile 2",
      lux: "10000000",
      memo: "tab dropped 1",
      to,
      typed: { amount: "0.01", memo: "tab dropped 1", to },
    });

    // Taken by Send, and left there before it's sent, as a call comes: said
    // still, here and after another reload.
    expect(noticesOf(container)).toStrictEqual([
      `Not sent: 0.01 DUSK to your Profile 2. tab dropped 1 · ${formatTime(at, { locale: "en" })} Nothing left your wallet. Send it now Don't send`,
    ]);

    const later = await openPage();
    const { container: laterPage } = later.render(later.Home);

    await vi.waitFor(() =>
      expect(noticesOf(laterPage)).toStrictEqual([
        expect.stringMatching(
          /^Not sent: 0\.01 DUSK to your Profile 2\. tab dropped 1 /
        ),
      ])
    );
    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is dropped with Don't send, here and after the next reload", async () => {
    const reloads = Promise.withResolvers();
    const before = await openPage();

    await sendWaiting(before, "left tab 1", reloads.promise);
    reloads.resolve(undefined);

    const after = await openPage();
    const { container, findByText, getByRole } = after.render(after.Home);

    await findByText("Not sent: 0.01 DUSK to your Profile 2.");
    await after.fireEvent.click(getByRole("button", { name: "Don't send" }));

    expect(noticesOf(container)).toStrictEqual([]);
    expect(app.goto).not.toHaveBeenCalled();
    expect(app.transfer).not.toHaveBeenCalled();

    const later = await openPage();
    const { container: laterPage } = later.render(later.Home);

    await vi.waitFor(() =>
      expect(get(later.transactions.unsentSends)).toStrictEqual([])
    );
    expect(noticesOf(laterPage)).toStrictEqual([]);
  });

  it("isn't said while it's sent in another tab, nor once it went out there: only once that tab goes", async () => {
    const otherTabGoes = Promise.withResolvers();
    const answered = Promise.withResolvers();
    const other = await openPage();
    const { gate: goesOut } = await sendWaiting(
      other,
      "goes out there",
      new Promise(() => {}),
      { operation: answered.promise }
    );

    await sendWaiting(other, "its tab goes", otherTabGoes.promise);

    // This tab opens the wallet while both wait in the other.
    const here = await openPage();
    const { container, findByText } = here.render(here.Home);

    // Asked for: each waits on the other tab.
    await vi.waitFor(async () =>
      expect((await navigator.locks.query()).pending).toHaveLength(2)
    );

    expect(noticesOf(container)).toStrictEqual([]);

    // One is handed over there, and the node answers: it went out, so it's
    // never said here.
    await goesOut.handOver({ hash: sentTx.hash, nonce: "107" });
    answered.resolve(sentTx.hash);

    await vi.waitFor(async () =>
      expect((await navigator.locks.query()).pending).toHaveLength(1)
    );

    expect(noticesOf(container)).toStrictEqual([]);
    expect(await keptNow()).toHaveLength(1);

    // The other tab goes before the other went out: said here now.
    otherTabGoes.resolve(undefined);

    await findByText("Not sent: 0.01 DUSK to your Profile 2.");

    expect(noticesOf(container)).toHaveLength(1);
    expect(noticesOf(container)[0]).toContain("its tab goes");
  });

  it("is kept as handed over, with its hash and nonce, before the node is asked to broadcast it, and the node isn't asked until it is", async () => {
    const page = await openPage();
    const sends = page.unsent.keptSendsDatabase.table("sends");
    const put = sends.put.bind(sends);
    const written = Promise.withResolvers();
    /** @type {any[]} */
    const handedOver = [];
    // What's kept as handed over takes its time to be on disk.
    const putting = vi.spyOn(sends, "put").mockImplementation(
      /** @type {any} */ (
        (/** @type {any} */ row) => {
          if (!row.handedOver) {
            return put(row);
          }

          handedOver.push(row);

          return written.promise.then(() => put(row));
        }
      )
    );
    const asked = get(page.transactions.broadcastsAsked);

    try {
      const sent = sendThrough(
        page,
        "on disk first",
        new Promise(() => {}),
        "broadcast"
      );

      await vi.waitFor(() => expect(handedOver).toHaveLength(1));

      // Not on disk yet: the node isn't asked to broadcast it.
      expect(get(page.transactions.broadcastsAsked)).toBe(asked);
      expect(
        (await keptNow()).filter((row) => row.handedOver !== undefined)
      ).toStrictEqual([]);

      written.resolve(undefined);
      await sent;
    } finally {
      putting.mockRestore();
    }

    expect(get(page.transactions.broadcastsAsked)).toBe(asked + 1);
    expect(await keptNow()).toStrictEqual([
      expect.objectContaining({
        handedOver: { hash: sentTx.hash, nonce: "107" },
        memo: "on disk first",
      }),
    ]);
  });

  /**
   * Opens the wallet again after its page died, the chain saying of the
   * transaction sent what `tx` says: null for nothing.
   *
   * @param {{ blockHeight: number, err: string | null } | null} tx
   */
  async function reopenWith(tx) {
    const page = await openPage();
    const { Network } = await import("@dusk/w3sper");
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockImplementation(async (/** @type {string | undefined} */ gql) =>
        String(gql).includes(`tx(hash: "${sentTx.hash}")`)
          ? { tx }
          : Promise.reject(new Error("Not asked here"))
      );

    return { page, query, ...page.render(page.Home) };
  }

  /** The toasts the page shows, as they read. */
  const toastsOf = (/** @type {Awaited<ReturnType<typeof openPage>>} */ page) =>
    get(page.toasts.toastList).map(({ message }) => message);

  it("is said as not sent where its page died before it was handed over: nothing left the wallet", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "built only", dies.promise, "built");
    dies.resolve(undefined);

    const { container, findByText, query } = await reopenWith(null);

    try {
      await findByText("Not sent: 0.01 DUSK to your Profile 2.");

      expect(noticesOf(container)).toHaveLength(1);
      expect(noticesOf(container)[0]).toContain("built only");
      expect(noticesOf(container)[0]).toContain("Nothing left your wallet.");
      // Nothing to look up: it never had a transaction to the node.
      expect(query).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
  });

  it("is never said as sent where its page died once it was kept as handed over, nothing broadcast, and another send then used its nonce: only its own transaction, found by its hash, says so, looked up while the wallet is open until the person is done with it", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "nonce used", dies.promise, "kept");
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const page = await openPage();
    const { AccountSyncer, Network } = await import("@dusk/w3sper");
    // Its hash can't be looked up, and another send took its nonce, 107.
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockRejectedValue(new Error("The node can't say"));
    const balances = vi
      .spyOn(AccountSyncer.prototype, "balances")
      .mockResolvedValue(/** @type {any} */ ([{ nonce: 108n, value: 0n }]));
    const { container, getByRole } = page.render(page.Home);

    try {
      const notConfirmed = [
        expect.stringMatching(
          /^Not confirmed: 0\.01 DUSK to your Profile 2\. nonce used · .+ It may have reached the network\. Check History before you send it again\. Open History Done$/
        ),
      ];

      // Looked up as the wallet opens: not found, so not confirmed, and
      // never said as sent.
      await vi.waitFor(() => expect(query).toHaveBeenCalled());
      await vi.waitFor(() =>
        expect(noticesOf(container)).toStrictEqual(notConfirmed)
      );

      expect(toastsOf(page)).toStrictEqual([]);

      // Again and again, past the first three minutes: no less kept.
      await vi.advanceTimersByTimeAsync(240_000);

      const asked = query.mock.calls.length;

      expect(asked).toBeGreaterThan(45);
      expect(toastsOf(page)).toStrictEqual([]);
      expect(noticesOf(container)).toStrictEqual(notConfirmed);

      // Still looked up a minute on, until the person is done with it.
      await vi.advanceTimersByTimeAsync(60_000);

      expect(query.mock.calls.length).toBeGreaterThan(asked);

      await page.fireEvent.click(getByRole("button", { name: "Done" }));

      const done = query.mock.calls.length;

      await vi.advanceTimersByTimeAsync(180_000);

      expect(noticesOf(container)).toStrictEqual([]);
      expect(query.mock.calls.length).toBe(done);
      expect(toastsOf(page)).toStrictEqual([]);
    } finally {
      query.mockRestore();
      balances.mockRestore();
      vi.useRealTimers();
    }

    await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is never said as not sent where its page died once it was kept as handed over, before the broadcast: it may have gone out, to check before sending it again", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "kept only", dies.promise, "kept");
    dies.resolve(undefined);

    const { container, findByText, getByRole, page, query } =
      await reopenWith(null);

    try {
      await findByText("Not confirmed: 0.01 DUSK to your Profile 2.");

      expect(noticesOf(container)).toStrictEqual([
        expect.stringMatching(
          /^Not confirmed: 0\.01 DUSK to your Profile 2\. kept only · .+ It may have reached the network\. Check History before you send it again\. Open History Done$/
        ),
      ]);
      expect(container).not.toHaveTextContent("Not sent");
      expect(container).not.toHaveTextContent("Nothing left your wallet");
      expect(getByRole("link", { name: "Open History" })).toHaveAttribute(
        "href",
        `/some-base-path/dashboard/transactions?tx=${sentTx.hash}`
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(`tx(hash: "${sentTx.hash}")`),
        expect.anything()
      );

      // Done once checked: said no more, here or after another reload.
      await page.fireEvent.click(getByRole("button", { name: "Done" }));

      expect(noticesOf(container)).toStrictEqual([]);
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
    } finally {
      query.mockRestore();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is said as sent where its page died once the node was asked to broadcast it, before it answered, and the chain has it: never as not sent", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(
      await openPage(),
      "broadcast, no answer",
      dies.promise,
      "broadcast"
    );
    dies.resolve(undefined);

    const { container, page, query } = await reopenWith({
      blockHeight: 4_850_155,
      err: null,
    });

    try {
      await vi.waitFor(() =>
        expect(toastsOf(page)).toStrictEqual([
          "Sent: 0.01 DUSK to your Profile 2. In block 4,850,155.",
        ])
      );

      expect(noticesOf(container)).toStrictEqual([]);
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
    } finally {
      query.mockRestore();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is said as not confirmed where its page died once the node was asked to broadcast it, and the chain doesn't have it yet, and as sent once it does", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(
      await openPage(),
      "broadcast, not in a block yet",
      dies.promise,
      "broadcast"
    );
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { container, findByText, page, query } = await reopenWith(null);

    try {
      await findByText("Not confirmed: 0.01 DUSK to your Profile 2.");

      expect(container).not.toHaveTextContent("Not sent");

      // A block takes it: looked up again a moment later, it's sent.
      query.mockImplementation(async () => ({
        tx: { blockHeight: 4_850_156, err: null },
      }));
      await vi.advanceTimersByTimeAsync(4_000);

      await vi.waitFor(() =>
        expect(toastsOf(page)).toStrictEqual([
          "Sent: 0.01 DUSK to your Profile 2. In block 4,850,156.",
        ])
      );
      expect(noticesOf(container)).toStrictEqual([]);
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }
  });

  it("isn't broadcast where what's kept of it can't say it was handed over, nor be forgotten: what's kept says then that nothing left the wallet, which is so", async () => {
    const page = await openPage();
    const sends = page.unsent.keptSendsDatabase.table("sends");
    const put = sends.put.bind(sends);
    // Storage takes it as it's sent, then refuses every write.
    const putting = vi
      .spyOn(sends, "put")
      .mockImplementation(
        /** @type {any} */ (
          (/** @type {any} */ row) =>
            row.handedOver
              ? Promise.reject(new Error("QuotaExceededError"))
              : put(row)
        )
      );
    const forgetting = vi
      .spyOn(sends, "delete")
      .mockRejectedValue(new Error("QuotaExceededError"));
    const asked = get(page.transactions.broadcastsAsked);
    const { Network } = await import("@dusk/w3sper");
    const network = new page.SendingNetwork(new URL("https://nodes.example/"));
    const execute = vi.spyOn(Network.prototype, "execute").mockImplementation(
      /** @this {any} */
      async function (/** @type {any} */ tx) {
        const transaction = await tx.build(this);

        await this.transactions.preverify(transaction.buffer);
        await this.transactions.propagate(transaction.buffer);

        return transaction;
      }
    );
    const dies = Promise.withResolvers();
    const gate = page.transactions.sendGate();
    const operation = network.execute(
      /** @type {any} */ ({
        build: async () => ({ ...sentTx, buffer: new Uint8Array([7]) }),
      }),
      { gate }
    );

    operation.catch(() => {});

    try {
      await sendWaiting(page, "storage full", dies.promise, {
        gate,
        operation,
      });

      await expect(operation).rejects.toThrow("QuotaExceededError");
      expect(get(page.transactions.broadcastsAsked)).toBe(asked);
      expect(
        page.transactions.describeFailure(
          await operation.catch((/** @type {Error} */ error) => error)
        )
      ).toMatchObject({ canRetry: true });

      // The page dies, and the wallet opens again.
      dies.resolve(undefined);

      const { container, findByText, query } = await reopenWith(null);

      try {
        await findByText("Not sent: 0.01 DUSK to your Profile 2.");

        expect(noticesOf(container)[0]).toContain("storage full");
      } finally {
        query.mockRestore();
      }
    } finally {
      execute.mockRestore();
      putting.mockRestore();
      forgetting.mockRestore();
    }
  });

  it("goes out where what's kept of it can't say it was handed over but can be forgotten: nothing says it didn't", async () => {
    const page = await openPage();
    const sends = page.unsent.keptSendsDatabase.table("sends");
    const put = sends.put.bind(sends);
    const putting = vi
      .spyOn(sends, "put")
      .mockImplementation(
        /** @type {any} */ (
          (/** @type {any} */ row) =>
            row.handedOver
              ? Promise.reject(new Error("QuotaExceededError"))
              : put(row)
        )
      );
    const asked = get(page.transactions.broadcastsAsked);
    const dies = Promise.withResolvers();

    try {
      await sendThrough(page, "forgotten first", dies.promise, "broadcast");
    } finally {
      putting.mockRestore();
    }

    expect(get(page.transactions.broadcastsAsked)).toBe(asked + 1);
    expect(await keptNow()).toStrictEqual([]);
    dies.resolve(undefined);

    const { container, query } = await reopenWith(null);

    try {
      await vi.waitFor(() =>
        expect(get(page.transactions.unsentSends)).toStrictEqual([])
      );
      expect(noticesOf(container)).toStrictEqual([]);
    } finally {
      query.mockRestore();
    }
  });

  it("is said where the wallet locked as it waited, or it failed with its screen gone, and not where the person called it off or its screen said it failed", async () => {
    const page = await openPage();
    const { keepWaiting, sendGate, unsentSends } = page.transactions;

    /**
     * Sends 0.01 DUSK to Profile 2 with `memo`, kept until it goes out.
     *
     * @param {string} memo
     * @param {Promise<unknown>} operation
     * @param {boolean} [isSaid] Whether its screen says how it ends
     */
    const sendIt = (memo, operation, isSaid = false) => {
      const gate = sendGate();

      keepWaiting({
        address: to,
        from,
        gate,
        kept: {
          account: from,
          isSaid: () => isSaid,
          network: "testnet",
          typed: { amount: "0.01", memo, to },
        },
        lux: 10_000_000n,
        memo,
        operation,
        to: "your Profile 2",
      });

      return gate;
    };
    const memos = () => get(unsentSends).map(({ memo }) => memo);

    const { container } = page.render(page.Home);

    // Called off by the person: nothing to say.
    sendIt("called off", new Promise(() => {})).cancel();

    // Failed with its screen showing it: said there.
    const failing = Promise.withResolvers();

    sendIt("said there", failing.promise, true);
    failing.reject(new Error("The network refused it."));

    // Failed while its screen was left: said here.
    const unseen = Promise.withResolvers();

    sendIt("screen left", unseen.promise, false);
    unseen.reject(new Error("The network refused it."));

    // The wallet locked as it waited.
    sendIt("locked", new Promise(() => {})).cancel(
      new page.errors.WalletChangedError()
    );

    await vi.waitFor(() =>
      expect(memos()).toStrictEqual(["screen left", "locked"])
    );
    await vi.waitFor(() => expect(noticesOf(container)).toHaveLength(2));

    expect(
      noticesOf(container).map((notice) => notice?.split(" · ")[0])
    ).toStrictEqual([
      "Not sent: 0.01 DUSK to your Profile 2. screen left",
      "Not sent: 0.01 DUSK to your Profile 2. locked",
    ]);
  });

  describe("as this browser's storage kept it before", () => {
    /** Where the wallet as it was before kept them: its storage. */
    const BEFORE = `${CONFIG.LOCAL_STORAGE_APP_KEY}-unsent-sends`;

    /**
     * A send as the wallet as it was before kept it, from Profile 1 to
     * Profile 2.
     *
     * @param {string} id
     * @param {string} memo
     */
    const keptBefore = (id, memo) => ({
      account: from,
      at: Date.now(),
      id,
      label: "your Profile 2",
      lux: "10000000",
      memo,
      network: "testnet",
      to,
      typed: { amount: "0.01", memo, to },
    });

    /** The locks asked for and not held yet, by name. */
    const waitingLocks = async () =>
      ((await navigator.locks.query()).pending ?? []).map(({ name }) => name);

    afterEach(() => {
      localStorage.removeItem(BEFORE);
    });

    it("is taken over as the wallet opens where no tab sends it, said as not sent, and gone from there", async () => {
      const send = keptBefore("before-left", "left before");

      localStorage.setItem(BEFORE, JSON.stringify([send]));

      const page = await openPage();
      const { container } = page.render(page.Home);

      await vi.waitFor(() =>
        expect(noticesOf(container)).toStrictEqual([
          expect.stringMatching(
            /^Not sent: 0\.01 DUSK to your Profile 2\. left before · .+ Nothing left your wallet\. Send it now Don't send$/
          ),
        ])
      );

      expect(await keptNow()).toStrictEqual([
        expect.objectContaining({ id: "before-left", memo: "left before" }),
      ]);
      expect(localStorage.getItem(BEFORE)).toBeNull();
      expect(app.transfer).not.toHaveBeenCalled();
    });

    it("is taken over only once no tab of the wallet as it was before sends it, and only where that tab kept it: one it sent is never said as not sent", async () => {
      const goesOut = keptBefore("before-goes-out", "sent there");
      const staysKept = keptBefore("before-stays", "kept there");
      const ends = [Promise.withResolvers(), Promise.withResolvers()];

      // A tab of the wallet as it was before sends both, holding their locks.
      localStorage.setItem(BEFORE, JSON.stringify([goesOut, staysKept]));

      const held = [goesOut, staysKept].map(({ id }, at) => {
        const holds = Promise.withResolvers();
        const lock = navigator.locks.request(`${LOCK}${id}`, () => {
          holds.resolve(undefined);

          return ends[at].promise;
        });

        return { holds: holds.promise, lock };
      });

      await Promise.all(held.map(({ holds }) => holds));

      const page = await openPage();
      const { container } = page.render(page.Home);

      // While they're sent there, waited for: nothing taken over, nor said.
      await vi.waitFor(async () =>
        expect(await waitingLocks()).toStrictEqual(
          expect.arrayContaining([
            `${LOCK}${goesOut.id}`,
            `${LOCK}${staysKept.id}`,
          ])
        )
      );

      expect(await keptNow()).toStrictEqual([]);
      expect(noticesOf(container)).toStrictEqual([]);

      // One goes out there, forgotten there before its lock goes; the other
      // is kept there as not sent, as its page locked.
      localStorage.setItem(BEFORE, JSON.stringify([staysKept]));
      ends[0].resolve(undefined);
      ends[1].resolve(undefined);
      await Promise.all(held.map(({ lock }) => lock));

      await vi.waitFor(() =>
        expect(noticesOf(container)).toStrictEqual([
          expect.stringMatching(
            /^Not sent: 0\.01 DUSK to your Profile 2\. kept there · /
          ),
        ])
      );

      expect(await keptNow()).toStrictEqual([
        expect.objectContaining({ id: staysKept.id }),
      ]);
      expect(container).not.toHaveTextContent("sent there");
      expect(localStorage.getItem(BEFORE)).toBeNull();
      expect(app.transfer).not.toHaveBeenCalled();
    });
  });
});
