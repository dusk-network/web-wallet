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

import {
  listLocalTransactions,
  putLocalTransaction,
} from "$lib/activity/activityStore";
import { NOT_CONFIRMED_YET, SENT_AFTER_DONT_SEND } from "$lib/activity/present";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { CHECKING_TEXT } from "$lib/transactions/sentMeanwhile";
import { keptSendsDatabase } from "$lib/transactions/unsentSends";
import { startIncarnation } from "$lib/wallets/dataNames";

/**
 * Text that names each of `values`, in any order, whatever its words: a
 * string whole, so `0.01 DUSK` is never found in `10.01 DUSK`; a regex as
 * the key phrase of a state; and `{ not }` as what it never says.
 *
 * @param {...(string | RegExp | { not: RegExp })} values
 */
const naming = (...values) =>
  expect.stringMatching(
    new RegExp(
      `^${values
        .map((value) =>
          typeof value === "string"
            ? `(?=.*(?<![\\w.,])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w))`
            : value instanceof RegExp
              ? `(?=.*(?${value.flags.includes("i") ? "i" : ""}:${value.source}))`
              : `(?!.*(?${value.not.flags.includes("i") ? "i" : ""}:${value.not.source}))`,
        )
        .join("")}`,
    ),
  );

/**
 * What sends, where the wallet goes, and the balances read again: nothing
 * sends here by itself.
 */
const app = vi.hoisted(() => ({
  goto: vi.fn(() => Promise.resolve()),
  refreshBalance: vi.fn(() => Promise.resolve()),
  sendAgain: vi.fn(() => Promise.resolve()),
  transfer: vi.fn(),
}));

vi.mock("$app/navigation", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  // Send's form asks to hear of the page being left: nothing leaves here.
  beforeNavigate: () => {},
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
      refreshBalance: app.refreshBalance,
      sendAgain: app.sendAgain,
      setCurrentProfile: () => Promise.resolve(),
      startHistory: () => ({ refresh: () => Promise.resolve() }),
      transfer: app.transfer,
      whileOpen: () => (/** @type {unknown} */ value) => value,
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

  /** Send's form as its page draws it, with the wallet open here. */
  const sendProps = {
    availableBalance: 1_000_000_000_000n,
    execute: vi.fn(),
    gasLimits: {
      gasLimitLower: 10_000_000n,
      gasLimitUpper: 2_900_000_000n,
      gasPriceLower: 1n,
    },
    gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
    publicAddress: from,
    resolveName: vi.fn(),
    shieldedAddress: String(currentProfile.address),
    shieldedBalance: 0n,
  };

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

    // Each page has a store of toasts of its own: they go with it.
    const toasts = await import("$lib/dusk/components/Toast/store");

    cleanups.push(toasts.dismissToasts);

    return {
      Home: (await import("../+page.svelte")).default,
      // The wallet's pages' own frame, whichever page shows in it.
      Layout: (await import("../../+layout.svelte")).default,
      SendingNetwork: (await import("$lib/transactions/SendingNetwork"))
        .default,
      TransactionResult: (
        await import("$lib/components/TransactionResult/TransactionResult.svelte")
      ).default,
      // Send's form, which says the sends not sent yet in its flow.
      Send: (await import("$lib/components/Send/Send.svelte")).default,
      errors: await import("$lib/errors"),
      fireEvent: testing.fireEvent,
      /**
       * @param {any} Component
       * @param {Record<string, unknown>} [given] Its props, Home's by default
       */
      render: (Component, given = props) => testing.render(Component, given),
      toasts: await import("$lib/dusk/components/Toast/store"),
      settingsStore: (await import("$lib/stores")).settingsStore,
      transactions: await import("$lib/transactions"),
      unsent: await import("$lib/transactions/unsentSends"),
      within: testing.within,
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
      ),
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
   * @param {{ gate?: import("$lib/transactions/sendGate").SendGate, operation?: Promise<unknown>, seen?: bigint }} [sending]
   *   `seen` the account's nonce as the wallet knew it as it was sent
   */
  async function sendWaiting(
    page,
    memo,
    gone,
    {
      gate = page.transactions.sendGate(),
      operation = new Promise(() => {}),
      seen,
    } = {},
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
        seen,
        typed: {
          amount: "0.01",
          isMax: false,
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
      },
    );
    const gate = page.transactions.sendGate();

    if (step === "kept") {
      // What's kept of it says so, and the page dies before the broadcast.
      gate.keepFirst(async () => {
        await vi.waitFor(async () =>
          expect(await keptNow()).toContainEqual(
            expect.objectContaining({ handedOver: expect.anything() }),
          ),
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
          { gate },
        ),
      });
      await reached.promise;
    } finally {
      execute.mockRestore();
    }

    expect(get(page.transactions.broadcastsAsked)).toBe(
      step === "broadcast" ? asked + 1 : asked,
    );
  }

  /**
   * The notices of sends the page shows: each as it reads, and what it
   * offers to do with its send, by its controls' names: to send it, now or
   * too, or not; to look it up, and be done with it; or nothing, as one the
   * chain has.
   *
   * @param {HTMLElement} container
   */
  const noticesOf = (container) =>
    Array.from(container.querySelectorAll(".unsent-send"), (shown) => ({
      offers: Array.from(shown.querySelectorAll("a, button"), (control) =>
        control.textContent?.trim(),
      ),
      says: shown.textContent?.replace(/\s+/g, " ").trim(),
    }));

  /*
   * Where a send is, as its notice says it: by the key phrase of that state,
   * what it never says then, and what it offers to do with the send, by its
   * controls' names.
   */

  /** It never went out: nothing left the wallet; to send it now, or not. */
  const NOT_SENT = {
    offers: ["Send now", "Don't send"],
    says: [/nothing left/i, { not: /may have|not sent yet/i }],
  };

  /**
   * Handed over, and the node doesn't have it: not sent yet, though it may
   * still arrive; to send it now, as it is, or not.
   */
  const NOT_SENT_YET = {
    offers: ["Send now", "Don't send"],
    says: [/not sent yet/i, { not: /nothing left/i }],
  };

  /**
   * Held as its account sent something else meanwhile: to send it too, or
   * not.
   */
  const HELD = {
    offers: ["Send it too", "Don't send"],
    says: [/your account sent/i, { not: /nothing left/i }],
  };

  /**
   * It may have gone out: to check Activity first, and be done with it;
   * never to send it again.
   */
  const MAY_HAVE_GONE_OUT = {
    offers: ["Open Activity", "Done"],
    says: [/may have gone out/i, { not: /nothing left|not sent/i }],
  };

  /** Sent, as the chain has it: nothing left to do with it. */
  const SENT = {
    offers: [],
    says: [/^sent\b/i, { not: /not sent|may have/i }],
  };

  /**
   * A notice of the send of 0.01 DUSK to Profile 2 with `memo`, as in
   * `state`, that names each of `also` too.
   *
   * @param {string} memo
   * @param {{ offers: string[], says: Array<RegExp | { not: RegExp }> }} state
   * @param {...(string | RegExp | { not: RegExp })} also
   */
  const notice = (memo, { offers, says }, ...also) => ({
    offers,
    says: naming(...says, "0.01 DUSK", "your Profile 2", memo, ...also),
  });

  /**
   * Waits until the page says these of the sends, and only these.
   *
   * @param {HTMLElement} container
   * @param {...ReturnType<typeof notice>} said
   */
  const untilSaid = (container, ...said) =>
    vi.waitFor(() => expect(noticesOf(container)).toStrictEqual(said));

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
    app.refreshBalance.mockReset();
    app.refreshBalance.mockImplementation(() => Promise.resolve());
    app.sendAgain.mockReset();
    app.sendAgain.mockImplementation(() => Promise.resolve());
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
    const { container, getByRole } = after.render(after.Home);
    const said = [
      notice("tab dropped 1", NOT_SENT, formatTime(at, { locale: "en" })),
    ];

    await untilSaid(container, ...said);
    expect(app.transfer).not.toHaveBeenCalled();

    // Send it now: Send's review, filled in with it, to send it from there.
    await after.fireEvent.click(getByRole("button", { name: "Send now" }));

    expect(app.goto).toHaveBeenCalledWith(
      expect.stringMatching(/\/dashboard\/send$/),
    );
    expect(app.transfer).not.toHaveBeenCalled();
    expect(
      after.transactions.takeUnsentRefill({
        account: from,
        network: "testnet",
      }),
    ).toMatchObject({
      label: "your Profile 2",
      lux: "10000000",
      memo: "tab dropped 1",
      to,
      typed: { amount: "0.01", memo: "tab dropped 1", to },
    });

    // Taken by Send, and left there before it's sent, as a call comes: said
    // still, here and after another reload.
    expect(noticesOf(container)).toStrictEqual(said);

    const later = await openPage();
    const { container: laterPage } = later.render(later.Home);

    await untilSaid(laterPage, notice("tab dropped 1", NOT_SENT));
    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("hides its amount on Home while balances are hidden, where it's browsed, and shows it on Send's page, in the flow", async () => {
    const reloads = Promise.withResolvers();
    const before = await openPage();

    await sendWaiting(before, "tab dropped 1", reloads.promise);
    reloads.resolve(undefined);

    const after = await openPage();

    after.settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = after.render(after.Home);

      await untilSaid(container, {
        offers: NOT_SENT.offers,
        says: naming(...NOT_SENT.says, "your Profile 2", "tab dropped 1", {
          not: /0\.01/,
        }),
      });

      const { container: onSend } = after.render(after.Send, sendProps);

      await untilSaid(onSend, notice("tab dropped 1", NOT_SENT));
      expect(app.transfer).not.toHaveBeenCalled();
    } finally {
      after.settingsStore.reset();
    }
  });

  // Chen's, on two phones, the tab dropped: the send waiting on phone A
  // was said "Not sent … Nothing left your wallet. Send it now", though
  // she'd paid the same from phone B meanwhile, which A's Activity didn't
  // list yet. Held as its account sent something else, or once its
  // account's nonce moved on since it was sent, it says so after a reload.
  it("says, once the wallet opens again, that its account sent something else while it waited, where it was held so, or its account's nonce moved on since, with Send it too to Review, never sent by itself", async () => {
    const { unshielded } = mockedWalletStore.getMockedStoreValue().balance;
    const reloads = Promise.withResolvers();
    const before = await openPage();
    const held = await sendWaiting(before, "night shift 5", reloads.promise, {
      seen: unshielded.nonce,
    });

    // Held as the person is asked, the page goes.
    held.gate.ask().catch(() => {});
    await vi.waitFor(async () =>
      expect(await keptNow()).toStrictEqual([
        expect.objectContaining({ memo: "night shift 5", sentElsewhere: true }),
      ]),
    );
    // Sent as the account's nonce was one less; and as it is still.
    await sendWaiting(before, "night shift 6", reloads.promise, {
      seen: unshielded.nonce - 1n,
    });
    await sendWaiting(before, "night shift 7", reloads.promise, {
      seen: unshielded.nonce,
    });
    reloads.resolve(undefined);

    const after = await openPage();
    const { container, getAllByRole } = after.render(after.Home);

    await vi.waitFor(() => expect(noticesOf(container)).toHaveLength(3));

    // Two sent the same moment may come back in either order.
    expect(noticesOf(container)).toEqual([
      notice("night shift 5", HELD),
      expect.any(Object),
      expect.any(Object),
    ]);
    expect(noticesOf(container)).toEqual(
      expect.arrayContaining([
        // What its account sent meanwhile is read first, its answers off.
        notice("night shift 6", HELD, CHECKING_TEXT),
        notice("night shift 7", NOT_SENT),
      ]),
    );
    expect(app.transfer).not.toHaveBeenCalled();

    // Send it too: Send's review, filled in with it, to send it from there.
    await after.fireEvent.click(
      getAllByRole("button", { name: "Send it too" })[0],
    );

    expect(app.goto).toHaveBeenCalledWith(
      expect.stringMatching(/\/dashboard\/send$/),
    );
    expect(app.transfer).not.toHaveBeenCalled();
    expect(
      after.transactions.takeUnsentRefill({
        account: from,
        network: "testnet",
      }),
    ).toMatchObject({ memo: "night shift 5", sentElsewhere: true });
  });

  it("is dropped with Don't send, here and after the next reload", async () => {
    const reloads = Promise.withResolvers();
    const before = await openPage();

    await sendWaiting(before, "left tab 1", reloads.promise);
    reloads.resolve(undefined);

    const after = await openPage();
    const { container, getByRole } = after.render(after.Home);

    await untilSaid(container, notice("left tab 1", NOT_SENT));
    await after.fireEvent.click(getByRole("button", { name: "Don't send" }));

    expect(noticesOf(container)).toStrictEqual([]);
    expect(app.goto).not.toHaveBeenCalled();
    expect(app.transfer).not.toHaveBeenCalled();

    const later = await openPage();
    const { container: laterPage } = later.render(later.Home);

    await vi.waitFor(() =>
      expect(get(later.transactions.unsentSends)).toStrictEqual([]),
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
      { operation: answered.promise },
    );

    await sendWaiting(other, "its tab goes", otherTabGoes.promise);

    // This tab opens the wallet while both wait in the other.
    const here = await openPage();
    const { container } = here.render(here.Home);

    // Asked for: each waits on the other tab.
    await vi.waitFor(async () =>
      expect((await navigator.locks.query()).pending).toHaveLength(2),
    );

    expect(noticesOf(container)).toStrictEqual([]);

    // One is handed over there, and the node answers: it went out, so it's
    // never said here.
    await goesOut.handOver({ hash: sentTx.hash, nonce: "107" });
    answered.resolve(sentTx.hash);

    await vi.waitFor(async () =>
      expect((await navigator.locks.query()).pending).toHaveLength(1),
    );

    expect(noticesOf(container)).toStrictEqual([]);
    expect(await keptNow()).toHaveLength(1);

    // The other tab goes before the other went out: said here now.
    otherTabGoes.resolve(undefined);

    await untilSaid(container, notice("its tab goes", NOT_SENT));
  });

  it("is kept as handed over, with its hash, nonce and signed bytes, before the node is asked to broadcast it, and the node isn't asked until it is", async () => {
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
      ),
    );
    const asked = get(page.transactions.broadcastsAsked);

    try {
      const sent = sendThrough(
        page,
        "on disk first",
        new Promise(() => {}),
        "broadcast",
      );

      await vi.waitFor(() => expect(handedOver).toHaveLength(1));

      // Not on disk yet: the node isn't asked to broadcast it.
      expect(get(page.transactions.broadcastsAsked)).toBe(asked);
      expect(
        (await keptNow()).filter((row) => row.handedOver !== undefined),
      ).toStrictEqual([]);

      written.resolve(undefined);
      await sent;
    } finally {
      putting.mockRestore();
    }

    expect(get(page.transactions.broadcastsAsked)).toBe(asked + 1);
    expect(await keptNow()).toStrictEqual([
      expect.objectContaining({
        handedOver: { hash: sentTx.hash, nonce: "107", tx: "07" },
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
          : Promise.reject(new Error("Not asked here")),
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

    const { container, query } = await reopenWith(null);

    try {
      await untilSaid(container, notice("built only", NOT_SENT));
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
      const notConfirmed = [notice("nonce used", MAY_HAVE_GONE_OUT)];

      // Looked up as the wallet opens: not found, so not confirmed, and
      // never said as sent.
      await vi.waitFor(() => expect(query).toHaveBeenCalled());
      await untilSaid(container, ...notConfirmed);

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

  /**
   * Opens the wallet again after its page died, its own transaction in no
   * block, and the account's transactions in final blocks, as the archive
   * lists them, those `taken()` says, each with its nonce, once `listed`
   * resolves.
   *
   * @param {() => Array<{ hash: string, nonce: number }>} taken
   * @param {Promise<unknown>} [listed]
   */
  async function reopenWithNonces(taken, listed = Promise.resolve()) {
    const page = await openPage();
    const { Network } = await import("@dusk/w3sper");
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockImplementation(async (/** @type {string | undefined} */ gql) => {
        const text = String(gql);

        if (text.startsWith(`out: moonlightHistory(sender: "${from}"`)) {
          await listed;

          return {
            out: {
              json: taken().map(({ hash }, i) => ({
                block_height: 4_850_160 + i,
                events: [],
                origin: hash,
              })),
            },
          };
        }

        if (text.startsWith("t0: ")) {
          return Object.fromEntries(
            Array.from(
              text.matchAll(/(t\d+): tx\(hash: "(\w+)"\)/g),
              ([, alias, hash]) => [
                alias,
                {
                  tx: {
                    json: JSON.stringify({
                      nonce: taken().find((tx) => tx.hash === hash)?.nonce,
                      sender: from,
                    }),
                  },
                },
              ],
            ),
          );
        }

        if (text.startsWith("block(height: -1)")) {
          return { block: { header: { height: 4_850_200 } } };
        }

        if (text.includes(`tx(hash: "${sentTx.hash}")`)) {
          return { tx: null };
        }

        throw new Error("Not asked here");
      });

    return { page, query, ...page.render(page.Home) };
  }

  // Marek's: the browser died before the broadcast, and the next send took
  // its nonce. It said "Not confirmed" and "on its way" for good.
  it("is said as not sent where its page died once it was kept as handed over, before the broadcast, once another transaction of its account took its nonce in a final block: that its account sent something else, to send too or not, and History no longer shows it", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(await openPage(), "nonce taken", dies.promise, "kept");
    // History's record of it, as kept as it was handed over.
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

    // The next send took its nonce, 107, its block not final yet: the
    // archive doesn't list it.
    /** @type {Array<{ hash: string, nonce: number }>} */
    let listed = [{ hash: "a1".repeat(32), nonce: 106 }];
    const { container, getByRole, page, query } = await reopenWithNonces(
      () => listed,
    );

    try {
      await untilSaid(container, notice("nonce taken", MAY_HAVE_GONE_OUT));

      // Its block final, the archive lists it: said as not sent once its
      // nonce is looked up again, a minute on, and kept so. Another
      // transaction took its place: its account sent something else.
      listed = [...listed, { hash: "b2".repeat(32), nonce: 107 }];
      await vi.advanceTimersByTimeAsync(60_000);

      await untilSaid(container, notice("nonce taken", HELD));
      expect(container).not.toHaveTextContent(NOT_CONFIRMED_YET);
      expect(toastsOf(page)).toStrictEqual([]);
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({ sentElsewhere: true }),
        ]),
      );
      expect(await keptNow()).toStrictEqual([
        expect.not.objectContaining({ handedOver: expect.anything() }),
      ]);
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([]),
      );

      // Nothing asked of the chain about it any more.
      const asked = query.mock.calls.length;

      await vi.advanceTimersByTimeAsync(180_000);

      expect(query.mock.calls.length).toBe(asked);
      expect(noticesOf(container)).toHaveLength(1);

      // Don't send: said no more.
      await page.fireEvent.click(getByRole("button", { name: "Don't send" }));

      expect(noticesOf(container)).toStrictEqual([]);
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  /**
   * Another tab sends a kept send again ("Send it now"), as another
   * transaction, under its ID, and closes once it's handed over, nothing
   * broadcast: what's kept of it, as that tab writes it.
   *
   * @param {string} hash
   */
  async function sentAgainElsewhere(hash) {
    const [row] = await keptNow();

    await keptSendsDatabase.table("sends").put({
      ...row,
      at: Date.now(),
      handedOver: { hash, nonce: "108" },
    });
    // As storage tells the tabs that tab changed it.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: `${CONFIG.LOCAL_STORAGE_APP_KEY}-unsent-sends-changed`,
      }),
    );
  }

  it("is looked up again as another tab sends it now, once it's said as not sent, and closes once it's handed over: said as not confirmed", async () => {
    const dies = Promise.withResolvers();
    const again = "ef".repeat(32);

    await sendThrough(await openPage(), "sent now", dies.promise, "kept");
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

    const { container, query } = await reopenWithNonces(() => [
      { hash: "b2".repeat(32), nonce: 107 },
    ]);

    try {
      await untilSaid(container, notice("sent now", HELD));
      await sentAgainElsewhere(again);

      await untilSaid(container, notice("sent now", MAY_HAVE_GONE_OUT));
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(`tx(hash: "${again}")`),
        expect.anything(),
      );
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is never said as not sent where another tab sent it again, as another transaction, as its nonce was looked up: what's kept of that one stays, said as not confirmed", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;
    const again = "ef".repeat(32);
    const listed = Promise.withResolvers();

    await sendThrough(await openPage(), "sent again", dies.promise, "kept");
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

    // Its nonce, 107, went to another transaction: the archive says so
    // once it's let answer.
    const { container, page, query } = await reopenWithNonces(
      () => [{ hash: "b2".repeat(32), nonce: 107 }],
      listed.promise,
    );

    try {
      await vi.waitFor(() =>
        expect(query).toHaveBeenCalledWith(
          expect.stringMatching(/^out: moonlightHistory/),
          expect.anything(),
        ),
      );

      // Meanwhile another tab sent it again, and closed.
      await sentAgainElsewhere(again);
      await vi.waitFor(() =>
        expect(get(page.unsent.unsentSends)).toStrictEqual([
          expect.objectContaining({
            handedOver: { hash: again, nonce: "108" },
          }),
        ]),
      );

      // The archive answers: History no longer shows the first, which can
      // never be in a block, and the one sent again is kept as it is.
      listed.resolve(undefined);
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([]),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(get(page.unsent.unsentSends)).toStrictEqual([
        expect.objectContaining({ handedOver: { hash: again, nonce: "108" } }),
      ]);
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: { hash: again, nonce: "108" },
          }),
        ]),
      );
      await untilSaid(container, notice("sent again", MAY_HAVE_GONE_OUT));
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is never said as not sent where the transaction its account's history has at its nonce is its own, nor where only later nonces are seen", async () => {
    for (const listed of [
      [{ hash: sentTx.hash, nonce: 107 }],
      [{ hash: "c3".repeat(32), nonce: 108 }],
    ]) {
      const dies = Promise.withResolvers();

      await keptSendsDatabase.table("sends").clear();
      await sendThrough(await openPage(), "its own", dies.promise, "kept");
      dies.resolve(undefined);

      const { container, query } = await reopenWithNonces(() => listed);
      const notConfirmed = [notice("its own", MAY_HAVE_GONE_OUT)];

      try {
        await untilSaid(container, ...notConfirmed);
        await vi.waitFor(() =>
          expect(query).toHaveBeenCalledWith(
            expect.stringMatching(/^t0: tx\(hash:/),
            expect.anything(),
          ),
        );

        // Still: never said as not sent.
        expect(noticesOf(container)).toStrictEqual(notConfirmed);
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: { hash: sentTx.hash, nonce: "107", tx: "07" },
          }),
        ]);
      } finally {
        query.mockRestore();
        cleanups.forEach((cleanup) => cleanup());
        cleanups = [];
      }
    }
  });

  it("is never said as not sent where its page died once it was kept as handed over, before the broadcast: it may have gone out, to check before sending it again", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "kept only", dies.promise, "kept");
    dies.resolve(undefined);

    const { container, getByRole, page, query } = await reopenWith(null);

    try {
      await untilSaid(container, notice("kept only", MAY_HAVE_GONE_OUT));
      expect(getByRole("link", { name: "Open Activity" })).toHaveAttribute(
        "href",
        `/some-base-path/dashboard/transactions?tx=${sentTx.hash}`,
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(`tx(hash: "${sentTx.hash}")`),
        expect.anything(),
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

  /**
   * Opens the wallet again after its page died, the node saying of the
   * transaction sent which block has it (`inBlock()`, none by default), and
   * whether its mempool has it (`queued()`), the chain that its account's
   * nonce is `nonce()`, and the archive which transactions of its account
   * took which nonce in final blocks (`taken()`, none by default). It shows
   * Home, Send's form, or the wallet's pages' frame alone (`shows`), as a
   * page with no notice of the send would.
   *
   * @param {{ inBlock?: () => { blockHeight: number, err: string | null } | null, nonce: () => bigint, queued: () => boolean, shows?: "Home" | "Layout" | "Send", taken?: () => Array<{ hash: string, nonce: number }> }} node
   */
  async function reopenWithNode({
    inBlock = () => null,
    nonce,
    queued,
    shows = "Home",
    taken = () => [],
  }) {
    const page = await openPage();
    const { AccountSyncer, Network } = await import("@dusk/w3sper");
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockImplementation(async (/** @type {string | undefined} */ gql) => {
        const text = String(gql);

        if (text.includes(`mempoolTx(hash: "${sentTx.hash}")`)) {
          return { queued: queued() ? { id: sentTx.hash } : null };
        }

        // Its account's transactions in final blocks, as the archive lists
        // them, and the nonce each took.
        if (text.startsWith(`out: moonlightHistory(sender: "${from}"`)) {
          return {
            out: {
              json: taken().map(({ hash }, i) => ({
                block_height: 4_850_160 + i,
                events: [],
                origin: hash,
              })),
            },
          };
        }

        if (text.startsWith("t0: ")) {
          return Object.fromEntries(
            Array.from(
              text.matchAll(/(t\d+): tx\(hash: "(\w+)"\)/g),
              ([, alias, hash]) => [
                alias,
                {
                  tx: {
                    json: JSON.stringify({
                      nonce: taken().find((tx) => tx.hash === hash)?.nonce,
                      sender: from,
                    }),
                  },
                },
              ],
            ),
          );
        }

        if (text.startsWith("block(height: -1)")) {
          return { block: { header: { height: 4_850_200 } } };
        }

        if (text.includes(`tx(hash: "${sentTx.hash}")`)) {
          return { tx: inBlock() };
        }

        throw new Error("Not asked here");
      });
    const balances = vi
      .spyOn(AccountSyncer.prototype, "balances")
      .mockImplementation(async () => [{ nonce: nonce(), value: 0n }]);

    return {
      page,
      restore: () => {
        query.mockRestore();
        balances.mockRestore();
      },
      ...(shows === "Home"
        ? page.render(page.Home)
        : shows === "Send"
          ? page.render(page.Send, sendProps)
          : page.render(page.Layout, {})),
    };
  }

  // Chen's, on hospital Wi-Fi: the node never got it, and it was "Not
  // confirmed yet" for good, with nothing to tap.
  it("is said as not sent yet where its page died once it was kept as handed over, and the node doesn't have it, in a block or its mempool, its nonce still free: nothing left the wallet, History doesn't show it, and Send it now sends the very same transaction again, once", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(await openPage(), "not known", dies.promise, "kept");
    // History's record of it, as an older wallet kept it.
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    let isQueued = false;
    const { container, getByRole, page, restore } = await reopenWithNode({
      nonce: () => 106n,
      queued: () => isQueued,
    });

    try {
      await untilSaid(container, notice("not known", NOT_SENT_YET));
      expect(container).not.toHaveTextContent(NOT_CONFIRMED_YET);
      // Never sent or on its way in History: not shown.
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([
          expect.objectContaining({ hash: sentTx.hash, status: "removed" }),
        ]),
      );
      expect(app.sendAgain).not.toHaveBeenCalled();

      // Send it now: its very bytes, hash and nonce, again; the node has it
      // then, and it's on its way.
      app.sendAgain.mockImplementation(async () => {
        isQueued = true;
      });
      await page.fireEvent.click(getByRole("button", { name: "Send now" }));

      await vi.waitFor(() => expect(noticesOf(container)).toStrictEqual([]));
      expect(app.sendAgain).toHaveBeenCalledExactlyOnceWith({
        account: from,
        hash: sentTx.hash,
        nonce: "107",
        tx: "07",
      });
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([
          expect.objectContaining({
            hash: sentTx.hash,
            status: expect.stringMatching(/^(submitted|mempool)$/),
          }),
        ]),
      );
      expect(await keptNow()).toStrictEqual([
        expect.objectContaining({
          handedOver: { hash: sentTx.hash, nonce: "107", tx: "07" },
        }),
      ]);
    } finally {
      restore();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is on its way as the node takes it again, though its mempool doesn't show it for a moment, and not sent yet again where the node still doesn't have it past that", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "taken again", dies.promise, "kept");
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

    const { container, getByRole, page, restore } = await reopenWithNode({
      nonce: () => 106n,
      queued: () => false,
    });
    const notSentYet = [notice("taken again", NOT_SENT_YET)];

    try {
      await untilSaid(container, ...notSentYet);
      await page.fireEvent.click(getByRole("button", { name: "Send now" }));

      await vi.waitFor(() => expect(app.sendAgain).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(noticesOf(container)).toStrictEqual([]));

      // Looked up again for a while: on its way, though the node's mempool
      // doesn't show it.
      await vi.advanceTimersByTimeAsync(20_000);

      expect(noticesOf(container)).toStrictEqual([]);

      // Past that, the node still doesn't have it: not sent yet again.
      await vi.advanceTimersByTimeAsync(20_000);

      await untilSaid(container, ...notSentYet);
      expect(app.sendAgain).toHaveBeenCalledOnce();
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it("is still not sent yet where the network refuses it as it's sent again, or can't be reached, and says so", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "refused again", dies.promise, "kept");
    dies.resolve(undefined);

    const { container, getByRole, page, restore } = await reopenWithNode({
      nonce: () => 106n,
      queued: () => false,
    });

    try {
      await untilSaid(
        container,
        notice("refused again", NOT_SENT_YET, {
          not: /refused it|couldn.t reach/i,
        }),
      );

      app.sendAgain.mockRejectedValueOnce(
        new Error("Tx not accepted: value spent larger than account holds"),
      );
      await page.fireEvent.click(getByRole("button", { name: "Send now" }));

      // Not sent yet still, to send now or not, and why: refused.
      await untilSaid(
        container,
        notice("refused again", NOT_SENT_YET, /refused it/i),
      );

      app.sendAgain.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await page.fireEvent.click(getByRole("button", { name: "Send now" }));

      // And why now: the network out of reach.
      await untilSaid(
        container,
        notice("refused again", NOT_SENT_YET, /couldn.t reach/i, {
          not: /refused it/i,
        }),
      );
      expect(app.sendAgain).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  // Astra's: Don't send forgot it and its record in History, though the
  // broadcast whose answer got lost could still go through, and the wallet
  // would then have said nothing was sent.
  it("is kept with Don't send where the node doesn't have it, its nonce still free: never sent again, said so, and said as sent after you chose not to send once the chain has it, until it's opened", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(await openPage(), "not wanted", dies.promise, "kept");
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    /** @type {{ blockHeight: number, err: string | null } | null} */
    let inBlock = null;
    const { container, getByRole, page, restore } = await reopenWithNode({
      inBlock: () => inBlock,
      nonce: () => 106n,
      queued: () => false,
    });
    const { lookAgainNow } = await import("$lib/transactions/handedOverSends");

    try {
      await untilSaid(container, notice("not wanted", NOT_SENT_YET));
      // Toasts stay as long as the app keeps them.
      page.toasts.toastTimer.set(5_000);
      await page.fireEvent.click(getByRole("button", { name: "Don't send" }));

      await vi.waitFor(() => expect(noticesOf(container)).toStrictEqual([]));
      await vi.waitFor(() =>
        expect(toastsOf(page)).toStrictEqual([
          naming(
            /not sent yet/i,
            { not: /nothing left/i },
            "0.01 DUSK",
            "your Profile 2",
          ),
        ]),
      );
      // Kept, its bytes forgotten, and History keeps it unseen.
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: { dismissed: true, hash: sentTx.hash, nonce: "107" },
          }),
        ]),
      );
      expect(await listLocalTransactions(owner)).toStrictEqual([
        expect.objectContaining({ hash: sentTx.hash, status: "removed" }),
      ]);

      // The broadcast went through after all: said so, in History too, and
      // kept as sent after the person chose not to, until it's opened
      // (Lena's and Chen's: "Sent after all" for a few seconds, then an
      // ordinary Sent row).
      inBlock = { blockHeight: 4_850_170, err: null };
      lookAgainNow();

      await untilSaid(
        container,
        notice("not wanted", SENT, SENT_AFTER_DONT_SEND, "4,850,170"),
      );

      const { get } = await import("svelte/store");
      const { sentAfterDontSend } =
        await import("$lib/transactions/sentAfterDontSend");

      expect(Object.keys(get(sentAfterDontSend))).toStrictEqual([
        sentTx.hash.toLowerCase(),
      ]);
      expect(await listLocalTransactions(owner)).toStrictEqual([
        expect.objectContaining({
          blockHeight: 4_850_170,
          hash: sentTx.hash,
          status: "executed",
        }),
      ]);
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
      expect(app.sendAgain).not.toHaveBeenCalled();
    } finally {
      restore();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("says Don't send's toast without its amount while balances are hidden, though Send's page, a flow, shows it", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "not wanted", dies.promise, "kept");
    dies.resolve(undefined);

    const { container, getByRole, page, restore } = await reopenWithNode({
      nonce: () => 106n,
      queued: () => false,
      shows: "Send",
    });
    /** Every toast's message, as each shows. */
    const said = /** @type {string[]} */ ([]);
    const listening = page.toasts.toastList.subscribe((list) =>
      said.push(...list.map(({ message }) => message)),
    );

    page.settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      // On Send's page, its figure.
      await untilSaid(container, notice("not wanted", NOT_SENT_YET));
      await page.fireEvent.click(getByRole("button", { name: "Don't send" }));

      // Over any page: none.
      await vi.waitFor(() =>
        expect(said).toContainEqual(
          naming(/not sent yet/i, "your Profile 2", { not: /0\.01/ }),
        ),
      );
      expect(said.filter((message) => message.includes("0.01"))).toStrictEqual(
        [],
      );
      // Done with it before the next test: kept as not to send, nothing
      // left to write.
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: expect.objectContaining({ dismissed: true }),
          }),
        ]),
      );
    } finally {
      listening();
      page.settingsStore.reset();
      restore();
    }
  });

  // Codex's, round 40: Don't send, the wallet locked, the payment landed
  // meanwhile, and the wallet opened straight into History: nothing looked
  // it up there, and its row stayed an ordinary Sent.
  it("is said as sent after you chose not to send once the chain has it, though the wallet opens on a page with no notice of it, as History", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(await openPage(), "not wanted", dies.promise, "kept");
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "removed",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);
    // Don't send, before the wallet locked: kept, its bytes forgotten.
    await keptSendsDatabase
      .table("sends")
      .toCollection()
      .modify((/** @type {any} */ send) => {
        send.handedOver = { dismissed: true, hash: sentTx.hash, nonce: "107" };
      });

    const { restore } = await reopenWithNode({
      inBlock: () => ({ blockHeight: 4_850_170, err: null }),
      nonce: () => 107n,
      queued: () => false,
      shows: "Layout",
    });

    try {
      const { get } = await import("svelte/store");
      const { sentAfterDontSend } =
        await import("$lib/transactions/sentAfterDontSend");

      await vi.waitFor(
        () =>
          expect(Object.keys(get(sentAfterDontSend))).toStrictEqual([
            sentTx.hash.toLowerCase(),
          ]),
        { timeout: 15_000 },
      );
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
      expect(await listLocalTransactions(owner)).toStrictEqual([
        expect.objectContaining({ hash: sentTx.hash, status: "executed" }),
      ]);
    } finally {
      restore();
    }
  }, 30_000);

  it("is done with, unsaid, after Don't send, once another transaction of its account took its nonce in a final block", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(await openPage(), "taken after", dies.promise, "kept");
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

    let nonce = 106n;
    /** @type {Array<{ hash: string, nonce: number }>} */
    let taken = [{ hash: "a1".repeat(32), nonce: 106 }];
    const { container, getByRole, page, restore } = await reopenWithNode({
      nonce: () => nonce,
      queued: () => false,
      taken: () => taken,
    });

    try {
      await untilSaid(container, notice("taken after", NOT_SENT_YET));
      await page.fireEvent.click(getByRole("button", { name: "Don't send" }));

      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: expect.objectContaining({ dismissed: true }),
          }),
        ]),
      );

      // The next send took its nonce, in a final block.
      nonce = 107n;
      taken = [...taken, { hash: "b2".repeat(32), nonce: 107 }];
      await vi.advanceTimersByTimeAsync(60_000);

      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
      expect(await listLocalTransactions(owner)).toStrictEqual([]);
      // Never said as not sent, its account having sent something else.
      expect(noticesOf(container)).toStrictEqual([]);
    } finally {
      restore();
      vi.useRealTimers();
    }

    expect(app.sendAgain).not.toHaveBeenCalled();
  });

  it("is never sent again in another tab once Don't send was chosen in one, though that tab still shows Send it now", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "two tabs", dies.promise, "kept");
    dies.resolve(undefined);

    const one = await reopenWithNode({
      nonce: () => 106n,
      queued: () => false,
    });

    try {
      const notSentYet = [notice("two tabs", NOT_SENT_YET)];

      await untilSaid(one.container, ...notSentYet);

      // Another tab, showing it as not sent yet too.
      const other = await openPage();
      const otherSends = await import("$lib/transactions/handedOverSends");
      const { container } = other.render(other.Home);
      const otherTab = other.within(container);

      await untilSaid(container, ...notSentYet);

      // Don't send in the first: the other hasn't heard of it yet.
      await one.page.fireEvent.click(
        one.page.within(one.container).getByRole("button", {
          name: "Don't send",
        }),
      );
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: expect.objectContaining({ dismissed: true }),
          }),
        ]),
      );

      await other.fireEvent.click(
        otherTab.getByRole("button", { name: "Send now" }),
      );

      await vi.waitFor(() =>
        expect(get(otherSends.handedOverStates).get(sentTx.hash)).toBe(
          "not-sent",
        ),
      );
      expect(app.sendAgain).not.toHaveBeenCalled();
    } finally {
      one.restore();
    }
  });

  // Astra's: sent again, its answer lost, History still had nothing of it
  // while it might go out.
  it("is said as not confirmed yet in History too where Send it now's answer gets lost", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(await openPage(), "lost again", dies.promise, "kept");
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    let isReached = true;
    const { container, getByRole, page, restore } = await reopenWithNode({
      nonce: () => 106n,
      queued: () => {
        if (!isReached) {
          throw new TypeError("Failed to fetch");
        }

        return false;
      },
    });
    const { outcomeUnknown } = await import("$lib/transactions/outcomeUnknown");

    try {
      await untilSaid(container, notice("lost again", NOT_SENT_YET));
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([
          expect.objectContaining({ status: "removed" }),
        ]),
      );

      // Its answer gets lost, and the node can't be asked of it since.
      app.sendAgain.mockImplementationOnce(async () => {
        isReached = false;

        throw outcomeUnknown(new TypeError("Failed to fetch"), sentTx.hash);
      });
      await page.fireEvent.click(getByRole("button", { name: "Send now" }));

      await untilSaid(container, notice("lost again", MAY_HAVE_GONE_OUT));
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([
          expect.objectContaining({ hash: sentTx.hash, status: "unknown" }),
        ]),
      );
    } finally {
      restore();
    }
  });

  it("is said as not sent yet where the node's answer to its broadcast got lost in the page that sent it, and the node doesn't have it, its nonce still free, and still once the wallet opens again: never sent, pending or not confirmed for good", async () => {
    const page = await openPage();
    const { Network } = await import("@dusk/w3sper");
    const network = new page.SendingNetwork(new URL("https://nodes.example/"));
    // The node's check answers, and the broadcast's connection drops.
    const execute = vi.spyOn(Network.prototype, "execute").mockImplementation(
      /** @this {any} */
      async function (/** @type {any} */ tx) {
        const transaction = await tx.build(this);

        await this.transactions.preverify(transaction.buffer);
        await this.transactions.propagate(transaction.buffer);

        throw new TypeError("Failed to fetch");
      },
    );
    const gate = page.transactions.sendGate();
    const operation = network.execute(
      /** @type {any} */ ({
        build: async () => ({ ...sentTx, buffer: new Uint8Array([7]) }),
      }),
      { gate },
    );

    operation.catch(() => {});

    try {
      await sendWaiting(page, "cancel race 4", new Promise(() => {}), {
        gate,
        operation,
      });
      await expect(operation).rejects.toThrow("Failed to fetch");
    } finally {
      execute.mockRestore();
    }

    // Kept as handed over: it may have gone out, for the node to say.
    await vi.waitFor(async () =>
      expect(await keptNow()).toStrictEqual([
        expect.objectContaining({
          handedOver: { hash: sentTx.hash, nonce: "107", tx: "07" },
          memo: "cancel race 4",
        }),
      ]),
    );

    const later = await reopenWithNode({
      nonce: () => 106n,
      queued: () => false,
    });

    try {
      await untilSaid(later.container, notice("cancel race 4", NOT_SENT_YET));
      expect(later.getByRole("button", { name: "Send now" })).toBeEnabled();
    } finally {
      later.restore();
    }

    expect(app.sendAgain).not.toHaveBeenCalled();
    expect(app.transfer).not.toHaveBeenCalled();
  });

  /**
   * Sends 0.01 DUSK to Profile 2 from a page, as Send does, and the node's
   * answer to its broadcast gets lost: its own screen shows it, its page
   * staying, the node saying of it that no block has it, and whether its
   * mempool has it (`queued()`), the chain that its account's nonce is
   * `nonce()`.
   *
   * @param {string} memo
   * @param {{ inBlock?: () => any, nonce: () => bigint, queued: () => boolean }} node
   *   `inBlock` the block that took it, as the node says it: none by default
   */
  async function loseAnswerOnScreen(
    memo,
    { inBlock = () => null, nonce, queued },
  ) {
    const page = await openPage();
    const { AccountSyncer, Network } = await import("@dusk/w3sper");
    const network = new page.SendingNetwork(new URL("https://nodes.example/"));
    const execute = vi.spyOn(Network.prototype, "execute").mockImplementation(
      /** @this {any} */
      async function (/** @type {any} */ tx) {
        const transaction = await tx.build(this);

        await this.transactions.preverify(transaction.buffer);
        await this.transactions.propagate(transaction.buffer);

        throw new TypeError("Failed to fetch");
      },
    );
    const query = vi
      .spyOn(Network.prototype, "query")
      .mockImplementation(async (/** @type {string | undefined} */ gql) => {
        const text = String(gql);

        if (text.includes(`mempoolTx(hash: "${sentTx.hash}")`)) {
          return { queued: queued() ? { id: sentTx.hash } : null };
        }

        if (text.includes(`tx(hash: "${sentTx.hash}")`)) {
          return { tx: inBlock() };
        }

        // The block that took it: final.
        if (text.startsWith("block(hash:")) {
          return { block: { status: { Final: null } } };
        }

        throw new Error("Not asked here");
      });
    const balances = vi
      .spyOn(AccountSyncer.prototype, "balances")
      .mockImplementation(async () => [{ nonce: nonce(), value: 0n }]);
    const gate = page.transactions.sendGate();
    const operation = network.execute(
      /** @type {any} */ ({
        build: async () => ({ ...sentTx, buffer: new Uint8Array([7]) }),
      }),
      { gate },
    );

    operation.catch(() => {});
    await sendWaiting(page, memo, new Promise(() => {}), { gate, operation });

    const screen = page.render(page.TransactionResult, {
      gate,
      maxFee: 2_500_000n,
      memo,
      operation,
      what: "0.01 DUSK to your Profile 2",
    });

    return {
      page,
      restore: () => {
        execute.mockRestore();
        query.mockRestore();
        balances.mockRestore();
      },
      ...screen,
    };
  }

  /** @param {HTMLElement} container */
  const resultOf = (container) =>
    container
      .querySelector(".transaction-status__summary")
      ?.textContent?.replace(/\s+/g, " ")
      .trim();

  it("is said as not sent yet on its own screen too, where the node's answer to its broadcast got lost and the node doesn't have it, its nonce free: Don't send drops it, nothing sent", async () => {
    const { container, findByRole, getByRole, page, queryByRole, restore } =
      await loseAnswerOnScreen("on its screen", {
        nonce: () => 106n,
        queued: () => false,
      });

    // Not sent yet, as it may still arrive: never that nothing left.
    const notSentYet = naming(
      /not sent yet/i,
      { not: /nothing left|sending/i },
      "0.01 DUSK to your Profile 2",
    );

    try {
      // Not sent yet: what, to whom, to send now or not.
      await findByRole("button", { name: "Send now" });

      expect(resultOf(container)).toEqual(notSentYet);

      await page.fireEvent.click(getByRole("button", { name: "Don't send" }));

      // It may still arrive: said so still, and kept, never to send again.
      await vi.waitFor(() =>
        expect(queryByRole("button", { name: "Send now" })).toBeNull(),
      );
      expect(resultOf(container)).toEqual(notSentYet);
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: { dismissed: true, hash: sentTx.hash, nonce: "107" },
          }),
        ]),
      );
      expect(app.sendAgain).not.toHaveBeenCalled();
    } finally {
      restore();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  // Lena's: after Don't send, the screen turned into a plain green "Sent at
  // 20:41:04" once the payment reached the network anyway, and she thought
  // her no had been ignored.
  it("says on its own screen, once it went out after Don't send, that it went out after you chose not to send, with the time it landed", async () => {
    const landed = Date.UTC(2026, 10, 17, 19, 41, 4);
    /** @type {any} */
    let block = null;
    const { container, findByRole, page, restore } = await loseAnswerOnScreen(
      "on its screen, landed",
      {
        inBlock: () => block,
        nonce: () => 106n,
        queued: () => false,
      },
    );

    try {
      await page.fireEvent.click(
        await findByRole("button", { name: "Don't send" }),
      );
      await vi.waitFor(async () =>
        expect(await keptNow()).toStrictEqual([
          expect.objectContaining({
            handedOver: expect.objectContaining({ dismissed: true }),
          }),
        ]),
      );

      // The broadcast whose answer got lost reaches a block all the same.
      block = {
        blockHash: "bb".repeat(32),
        blockHeight: 4_850_170,
        blockTimestamp: landed / 1000,
        err: null,
        gasSpent: "1856521",
        tx: { gasPrice: "1" },
      };

      const { lookAgainNow } =
        await import("$lib/transactions/handedOverSends");

      lookAgainNow();

      const { timeLabel } = await import("$lib/activity/present");

      await vi.waitFor(
        () =>
          expect(resultOf(container)).toEqual(
            naming(
              SENT_AFTER_DONT_SEND,
              timeLabel(landed, "en", { seconds: true }),
              "0.01 DUSK to your Profile 2",
              "4,850,170",
            ),
          ),
        { timeout: 15_000 },
      );
      expect(container.querySelector(".transaction-status")).toHaveClass(
        "transaction-status--declined",
      );
    } finally {
      restore();
    }
  }, 30_000);

  it("is sent again as it is from its own screen with Send it now, where the node doesn't have it: on its way once the node has it", async () => {
    let isQueued = false;
    const { container, findByRole, page, queryByRole, restore } =
      await loseAnswerOnScreen("sent from its screen", {
        nonce: () => 106n,
        queued: () => isQueued,
      });

    try {
      const sendNow = await findByRole("button", { name: "Send now" });

      expect(resultOf(container)).toEqual(
        naming(/not sent yet/i, "0.01 DUSK to your Profile 2"),
      );

      app.sendAgain.mockImplementation(async () => {
        isQueued = true;
      });
      await page.fireEvent.click(sendNow);

      await vi.waitFor(() => expect(app.sendAgain).toHaveBeenCalled());
      expect(app.sendAgain).toHaveBeenCalledExactlyOnceWith({
        account: from,
        hash: sentTx.hash,
        nonce: "107",
        tx: "07",
      });

      // The node took it: on its way, sending, with nothing left to send,
      // or not.
      await Promise.resolve(app.sendAgain.mock.results[0]?.value).catch(
        () => {},
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(queryByRole("button", { name: "Send now" })).toBeNull();
      expect(resultOf(container)).toEqual(
        naming(/sending/i, { not: /not sent/i }, "0.01 DUSK to your Profile 2"),
      );
    } finally {
      restore();
    }
  });

  it("is never said as not sent yet where the node has it in its mempool, nor where its account's nonce moved on: on its way, or not confirmed until the chain says", async () => {
    const owner = `testnet::${from}`;
    const queuedDies = Promise.withResolvers();

    // The node has it in its mempool: on its way, in History too.
    await sendThrough(await openPage(), "queued", queuedDies.promise, "kept");
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "unknown",
      submittedAt: Date.now(),
    });
    queuedDies.resolve(undefined);

    const queued = await reopenWithNode({
      nonce: () => 106n,
      queued: () => true,
    });

    try {
      await vi.waitFor(async () =>
        expect(await listLocalTransactions(owner)).toStrictEqual([
          expect.objectContaining({ hash: sentTx.hash, status: "mempool" }),
        ]),
      );
      expect(noticesOf(queued.container)).toStrictEqual([]);
    } finally {
      queued.restore();
      cleanups.forEach((cleanup) => cleanup());
      cleanups = [];
    }

    // Its account's nonce moved on, by what isn't known yet: not confirmed.
    const usedDies = Promise.withResolvers();

    await keptSendsDatabase.table("sends").clear();
    await sendThrough(
      await openPage(),
      "nonce moved",
      usedDies.promise,
      "kept",
    );
    usedDies.resolve(undefined);

    const used = await reopenWithNode({
      nonce: () => 107n,
      queued: () => false,
    });

    try {
      await untilSaid(used.container, notice("nonce moved", MAY_HAVE_GONE_OUT));
    } finally {
      used.restore();
    }
  });

  // Then Chen's: the notice went with no word that it went out, and the
  // total and History's row disagreed for 5 to 13 seconds.
  it("is said as sent in its notice's place where its page died once the node was asked to broadcast it, before it answered, and the chain has it, once the balances are read again, in History too: never as not sent", async () => {
    const dies = Promise.withResolvers();
    // History's record of it, as kept as it was handed over.
    const owner = `testnet::${from}`;

    await sendThrough(
      await openPage(),
      "broadcast, no answer",
      dies.promise,
      "broadcast",
    );
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    // The balances take their time to be read again.
    const read = Promise.withResolvers();

    app.refreshBalance.mockImplementation(() => read.promise);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { container, page, query } = await reopenWith({
      blockHeight: 4_850_155,
      err: null,
    });

    try {
      await vi.waitFor(() => expect(app.refreshBalance).toHaveBeenCalled());

      // Found: not said sent yet, nor in History, until the balances are
      // read; History says it's not confirmed yet, as its answer never came.
      expect(container).not.toHaveTextContent("4,850,155");
      expect(await listLocalTransactions(owner)).toStrictEqual([
        expect.objectContaining({ hash: sentTx.hash, status: "unknown" }),
      ]);

      read.resolve(undefined);

      await untilSaid(
        container,
        notice("broadcast, no answer", SENT, "4,850,155"),
      );
      expect(await listLocalTransactions(owner)).toStrictEqual([
        expect.objectContaining({
          blockHeight: 4_850_155,
          hash: sentTx.hash,
          status: "executed",
        }),
      ]);
      expect(toastsOf(page)).toStrictEqual([]);
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));

      // Said for a moment, then not.
      await vi.advanceTimersByTimeAsync(8_000);

      expect(noticesOf(container)).toStrictEqual([]);
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }

    expect(app.transfer).not.toHaveBeenCalled();
  });

  it("is said as sent where the chain has it though the balances' read hangs, with the wallet's sync: once it waited as long as the network gets to answer, in History too", async () => {
    const dies = Promise.withResolvers();
    const owner = `testnet::${from}`;

    await sendThrough(
      await openPage(),
      "sync hangs",
      dies.promise,
      "broadcast",
    );
    await putLocalTransaction(owner, {
      hash: sentTx.hash,
      status: "submitted",
      submittedAt: Date.now(),
    });
    dies.resolve(undefined);

    // The balances' read never ends.
    app.refreshBalance.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { container, query } = await reopenWith({
      blockHeight: 4_850_158,
      err: null,
    });

    try {
      await vi.waitFor(() => expect(app.refreshBalance).toHaveBeenCalled());

      expect(container).not.toHaveTextContent("4,850,158");

      await vi.advanceTimersByTimeAsync(10_000);

      await untilSaid(container, notice("sync hangs", SENT, "4,850,158"));
      expect(await listLocalTransactions(owner)).toStrictEqual([
        expect.objectContaining({ hash: sentTx.hash, status: "executed" }),
      ]);
      await vi.waitFor(async () => expect(await keptNow()).toStrictEqual([]));
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }
  });

  it("is said as not confirmed where its page died once the node was asked to broadcast it, and the chain doesn't have it yet, and as sent once it does", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(
      await openPage(),
      "broadcast, not in a block yet",
      dies.promise,
      "broadcast",
    );
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const { container, page, query } = await reopenWith(null);

    try {
      await untilSaid(
        container,
        notice("broadcast, not in a block yet", MAY_HAVE_GONE_OUT),
      );

      // A block takes it: looked up again a moment later, it's sent.
      query.mockImplementation(async () => ({
        tx: { blockHeight: 4_850_156, err: null },
      }));
      await vi.advanceTimersByTimeAsync(4_000);

      await untilSaid(
        container,
        notice("broadcast, not in a block yet", SENT, "4,850,156"),
      );
      expect(toastsOf(page)).toStrictEqual([]);
    } finally {
      query.mockRestore();
      vi.useRealTimers();
    }
  });

  // Chen's, the other way round: the total had moved while History still
  // said Pending, as the send was looked up only at its next turn.
  it("is looked up at once, not at its next turn, as the balances change", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(
      await openPage(),
      "balances moved",
      dies.promise,
      "broadcast",
    );
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const before = mockedWalletStore.getMockedStoreValue();
    const { container, query } = await reopenWith(null);

    try {
      await untilSaid(container, notice("balances moved", MAY_HAVE_GONE_OUT));

      // Past its first minutes: looked up once a minute from then on.
      await vi.advanceTimersByTimeAsync(200_000);

      const asked = query.mock.calls.length;

      // A block takes it, and the balances read change with it.
      query.mockImplementation(async () => ({
        tx: { blockHeight: 4_850_157, err: null },
      }));
      mockedWalletStore.setMockedStoreValue({
        ...before,
        balance: {
          shielded: { spendable: 0n, value: 0n },
          unshielded: { nonce: 108n, value: 1n },
        },
      });

      await untilSaid(container, notice("balances moved", SENT, "4,850,157"));
      expect(query.mock.calls.length).toBeGreaterThan(asked);
    } finally {
      query.mockRestore();
      mockedWalletStore.setMockedStoreValue(before);
      vi.useRealTimers();
    }
  });

  // Chen's, on flaky Wi-Fi: not confirmed while the network was out of
  // reach, it's looked up as soon as the network answers again.
  it("is looked up at once, not at its next turn, as the network answers again: not sent yet, where the node doesn't have it", async () => {
    const dies = Promise.withResolvers();

    await sendThrough(await openPage(), "back online", dies.promise, "kept");
    dies.resolve(undefined);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    // The node can't be reached for now.
    let isReached = false;
    const { container, page, restore } = await reopenWithNode({
      nonce: () => 106n,
      queued: () => {
        if (!isReached) {
          throw new TypeError("Failed to fetch");
        }

        return false;
      },
    });
    const { setNetworkReach } = await import("$lib/stores/networkReach");

    try {
      await untilSaid(container, notice("back online", MAY_HAVE_GONE_OUT));
      setNetworkReach("offline");

      // Past its first minutes: looked up once a minute from then on.
      await vi.advanceTimersByTimeAsync(200_000);

      // The network answers again: looked up at once.
      isReached = true;
      setNetworkReach("answering");

      await untilSaid(container, notice("back online", NOT_SENT_YET));
      expect(page.unsent).toBeDefined();
    } finally {
      restore();
      setNetworkReach("answering");
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
        ),
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
      },
    );
    const dies = Promise.withResolvers();
    const gate = page.transactions.sendGate();
    const operation = network.execute(
      /** @type {any} */ ({
        build: async () => ({ ...sentTx, buffer: new Uint8Array([7]) }),
      }),
      { gate },
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
          await operation.catch((/** @type {Error} */ error) => error),
        ),
      ).toMatchObject({ canRetry: true });

      // The page dies, and the wallet opens again.
      dies.resolve(undefined);

      const { container, query } = await reopenWith(null);

      try {
        await untilSaid(container, notice("storage full", NOT_SENT));
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
        ),
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
        expect(get(page.transactions.unsentSends)).toStrictEqual([]),
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
      new page.errors.WalletChangedError(),
    );

    await vi.waitFor(() =>
      expect(memos()).toStrictEqual(["screen left", "locked"]),
    );
    await vi.waitFor(() => expect(noticesOf(container)).toHaveLength(2));

    expect(noticesOf(container)).toStrictEqual([
      notice("screen left", NOT_SENT),
      notice("locked", NOT_SENT),
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

      await untilSaid(container, notice("left before", NOT_SENT));

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
          ]),
        ),
      );

      expect(await keptNow()).toStrictEqual([]);
      expect(noticesOf(container)).toStrictEqual([]);

      // One goes out there, forgotten there before its lock goes; the other
      // is kept there as not sent, as its page locked.
      localStorage.setItem(BEFORE, JSON.stringify([staysKept]));
      ends[0].resolve(undefined);
      ends[1].resolve(undefined);
      await Promise.all(held.map(({ lock }) => lock));

      await untilSaid(container, notice("kept there", NOT_SENT));

      expect(await keptNow()).toStrictEqual([
        expect.objectContaining({ id: staysKept.id }),
      ]);
      expect(container).not.toHaveTextContent("sent there");
      expect(localStorage.getItem(BEFORE)).toBeNull();
      expect(app.transfer).not.toHaveBeenCalled();
    });
  });
});
