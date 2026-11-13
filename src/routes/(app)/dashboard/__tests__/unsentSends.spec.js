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
      errors: await import("$lib/errors"),
      fireEvent: testing.fireEvent,
      /** @param {any} Component */
      render: (Component) => testing.render(Component, props),
      transactions: await import("$lib/transactions"),
    };
  }

  /**
   * Sends 0.01 DUSK to Profile 2 from a page, as Send does, and it waits for
   * the network; the page goes as `gone` resolves, and its locks with it.
   * Resolves once the page holds the send's lock.
   *
   * @param {Awaited<ReturnType<typeof openPage>>} page
   * @param {string} memo
   * @param {Promise<unknown>} gone
   */
  async function sendWaiting(page, memo, gone) {
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
    const gate = page.transactions.sendGate();

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
      operation: new Promise(() => {}),
      to: "your Profile 2",
    });

    const [{ at }] = get(page.transactions.waitingSends).slice(-1);

    await held.promise;
    locks.mockRestore();

    return { at, gate };
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

  beforeEach(() => {
    localStorage.clear();
    // The wallet as it's set up here.
    startIncarnation("");
  });

  afterEach(() => {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    app.goto.mockClear();
    app.transfer.mockClear();
  });

  afterAll(() => {
    localStorage.clear();
    vi.doUnmock("$app/navigation");
    vi.doUnmock("$lib/stores");
    vi.doUnmock("$lib/sozu");
  });

  it("is said once the wallet opens again after its page reloaded as it waited for the network: what, to whom, its memo and when, to send now or not, never sent by itself", async () => {
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

    // Send it now: Send, filled in with it, to be reviewed.
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

    // Taken by Send: said no more, here or after another reload.
    await vi.waitFor(() => expect(noticesOf(container)).toStrictEqual([]));

    const later = await openPage();
    const { container: laterPage } = later.render(later.Home);

    await vi.waitFor(() =>
      expect(get(later.transactions.unsentSends)).toStrictEqual([])
    );
    expect(noticesOf(laterPage)).toStrictEqual([]);
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

  it("isn't said while it waits in another tab, nor once it went out there: only once that tab goes", async () => {
    const otherTabGoes = Promise.withResolvers();
    const other = await openPage();
    const { gate: goesOut } = await sendWaiting(
      other,
      "goes out there",
      new Promise(() => {})
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

    // One goes out there: it was sent, so it's never said here.
    goesOut.handOver();

    await vi.waitFor(async () =>
      expect((await navigator.locks.query()).pending).toHaveLength(1)
    );

    expect(noticesOf(container)).toStrictEqual([]);

    // The other tab goes before the other went out: said here now.
    otherTabGoes.resolve(undefined);

    await findByText("Not sent: 0.01 DUSK to your Profile 2.");

    expect(noticesOf(container)).toHaveLength(1);
    expect(noticesOf(container)[0]).toContain("its tab goes");
  });

  it("isn't said once its page went after the node was asked to broadcast it, though no answer came, as it may have gone out: only one never handed over is", async () => {
    const reloads = Promise.withResolvers();
    const before = await openPage();
    const { gate } = await sendWaiting(
      before,
      "asked to broadcast",
      reloads.promise
    );

    await sendWaiting(before, "never handed over", reloads.promise);

    const { Network } = await import("@dusk/w3sper");
    const { default: SendingNetwork } =
      await import("$lib/transactions/SendingNetwork");
    const asked = Promise.withResolvers();
    // w3sper's execute: built, checked by the node, then broadcast. The node
    // is asked to broadcast the first, and its answer never comes back.
    const execute = vi.spyOn(Network.prototype, "execute").mockImplementation(
      /** @this {any} */
      async function (/** @type {any} */ tx) {
        const transaction = await tx.build(this);

        await this.transactions.preverify(transaction.buffer);
        void this.transactions.propagate(transaction.buffer);
        asked.resolve(undefined);

        return new Promise(() => {});
      }
    );

    try {
      void new SendingNetwork(new URL("https://nodes.example/")).execute(
        /** @type {any} */ ({
          build: async () => ({
            buffer: new Uint8Array([7]),
            hash: "ab".repeat(32),
          }),
        }),
        { gate }
      );
      await asked.promise;
    } finally {
      execute.mockRestore();
    }

    expect(get(gate)).toBe("handed-over");

    // Its page goes before the node answers, and the wallet opens again.
    reloads.resolve(undefined);

    const after = await openPage();
    const { container, findByText } = after.render(after.Home);

    await findByText("Not sent: 0.01 DUSK to your Profile 2.");

    expect(noticesOf(container)).toHaveLength(1);
    expect(noticesOf(container)[0]).toContain("never handed over");
    expect(container).not.toHaveTextContent("asked to broadcast");
    expect(
      get(after.transactions.unsentSends).map(({ memo }) => memo)
    ).toStrictEqual(["never handed over"]);
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
});
