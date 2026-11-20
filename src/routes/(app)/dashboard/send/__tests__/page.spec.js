import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { getGasSettings } from "$lib/contracts";
import {
  formatDusk,
  formatDuskExact,
  formatDuskPlain,
} from "$lib/dusk/currency";
import { gasPriceStore, networkStore, settingsStore } from "$lib/stores";
import { keepWaiting, sendGate } from "$lib/transactions";
import { feeToKeep } from "$lib/wallet-reserve";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { GAS_PRICE_BUSY } from "@dusk-network/app-core/gas";
import { networks } from "@dusk-network/networks";

import { rowOf } from "$lib/activity/__tests__/fixtures/rows";

import SendPage from "../+page.svelte";

const { resolveDuskName } = vi.hoisted(() => ({ resolveDuskName: vi.fn() }));

const page = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<{ url: URL }> | null} */
  store: null,
  url: new URL("http://localhost/some-base-path/dashboard/send"),
}));

vi.mock("$app/stores", async () => {
  const { readable, writable } = await import("svelte/store");

  page.store = writable({ url: page.url });

  return {
    // No navigation under way.
    navigating: readable(null),
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        /** @type {NonNullable<typeof page.store>} */ (page.store).subscribe(
          run,
        ),
    },
  };
});

/** @param {URL} url */
const openAt = (url) => {
  page.url = url;
  page.store?.set({ url });
};

const history = vi.hoisted(() => ({
  /**
   * All of the history, as the page reads it.
   *
   * @type {import("svelte/store").Writable<any> | null}
   */
  whole: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  history.whole = writable({
    failed: false,
    reading: false,
    rows: [],
    whole: true,
  });

  return {
    .../** @type {object} */ (await importOriginal()),
    wholeActivity: history.whole,
  };
});

vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {typeof import("$lib/dusk-domains")} */ (await importOriginal()),
  resolveDuskName,
}));

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

const { balance, currentProfile } = mockedWalletStore.getMockedStoreValue();
const OTHER =
  "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";

/** @param {HTMLElement} container */
const available = (container) =>
  container.querySelector(".send__amount + .send__hint");

/**
 * An amount in DUSK as a whole figure, never part of another: `5 DUSK`, but
 * not `15 DUSK` or `0.5 DUSK`.
 *
 * @param {bigint} lux
 */
const duskFigure = (lux) =>
  new RegExp(
    `(?<![\\d.,])${formatDusk(lux, "en").replace(/\./g, "\\.")} DUSK\\b`,
  );

// What Available holds of the balance the page pays from: the two differ
// here, so the figure says which.
const PUBLIC_BALANCE = duskFigure(balance.unshielded.value);
const SHIELDED_BALANCE = duskFigure(balance.shielded.spendable);

/**
 * What a row of the summary, or of the review, says: found by its label.
 *
 * @param {HTMLElement} container
 * @param {RegExp} label
 */
const summaryRow = (container, label) =>
  /** @type {HTMLElement} */ (
    Array.from(container.querySelectorAll(".send__summary dt")).find((term) =>
      label.test(term.textContent?.trim() ?? ""),
    )?.nextElementSibling
  );

// The profiles' addresses here are made up, so none is two keys, and the
// accounts none a key.
vi.mock("$lib/wallet/isShieldedAddress", () => ({ default: () => true }));
vi.mock("@dusk-network/networks/account", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  isAccount: () => true,
}));

describe("Send page", () => {
  afterEach(() => {
    cleanup();
    resolveDuskName.mockReset();
    settingsStore.reset();
    openAt(new URL("http://localhost/some-base-path/dashboard/send"));
  });

  afterAll(() => {
    vi.doUnmock("$app/stores");
    vi.doUnmock("$lib/activity");
    vi.doUnmock("$lib/dusk-domains");
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
  });

  describe("opened from a link", () => {
    /** @param {string} query */
    const openLink = (query) =>
      openAt(
        new URL(`http://localhost/some-base-path/dashboard/send?${query}`),
      );

    /** @param {(role: string, options: object) => HTMLElement} getByRole */
    const fieldsAre = (getByRole) =>
      ["To", "Amount", /^Memo/].map(
        (name) =>
          /** @type {HTMLInputElement} */ (getByRole("textbox", { name }))
            .value,
      );

    /**
     * The readings an amount's question offers, a button each.
     *
     * @param {HTMLElement} question
     */
    const readingsOf = (question) =>
      within(question)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim());

    afterEach(() => setNodeNetwork(null));

    it("should open filled in, with what the link asks", () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=0.15&memo=Factura+33&network=testnet`);

      const { getByRole } = render(SendPage);

      expect(fieldsAre(getByRole)).toStrictEqual([OTHER, "0.15", "Factura 33"]);
    });

    it("should ask of a link's amount what typing it asks, as 2.125, with a button for each reading", async () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=2.125&memo=Factura+34&network=testnet`);

      const { getByRole } = render(SendPage);

      expect(fieldsAre(getByRole)).toStrictEqual([
        OTHER,
        "2.125",
        "Factura 34",
      ]);
      expect(readingsOf(getByRole("alert"))).toStrictEqual([
        "2.1250 DUSK",
        "2125 DUSK",
      ]);

      await fireEvent.click(getByRole("button", { name: "2.1250 DUSK" }));

      expect(fieldsAre(getByRole)).toStrictEqual([
        OTHER,
        "2.1250",
        "Factura 34",
      ]);
    });

    // Lena's, in de-DE: a link's amount=1.000 filled in "1,000", which reads
    // as one to her, where typed "1.000" asks which is meant.
    it("should ask of a link's amount that reads two ways in the language set what typing it asks, opened or pasted", async () => {
      setNodeNetwork(networks.testnet);
      settingsStore.update((settings) => ({ ...settings, language: "de-DE" }));
      openLink(`to=${OTHER}&amount=1.000&memo=Miete&network=testnet`);

      const opened = render(SendPage);

      expect(fieldsAre(opened.getByRole)[1]).toBe("1,000");
      expect(readingsOf(opened.getByRole("alert"))).toStrictEqual([
        "1 DUSK",
        "1000 DUSK",
      ]);

      cleanup();
      openAt(new URL("http://localhost/some-base-path/dashboard/send"));

      const pasted = render(SendPage);
      const to = pasted.getByRole("textbox", { name: "To" });
      const link = `https://apps.testnet.dusk.network/wallet/dashboard/send?to=${OTHER}&amount=1.000&memo=Miete&network=testnet`;

      await fireEvent.paste(to, {
        clipboardData: { getData: () => link },
      });
      await fireEvent.input(to, { target: { value: link } });
      await vi.waitFor(() =>
        expect(fieldsAre(pasted.getByRole)[1]).toBe("1,000"),
      );

      expect(readingsOf(pasted.getByRole("alert"))).toStrictEqual([
        "1 DUSK",
        "1000 DUSK",
      ]);

      // Typed, it asks the same.
      await fireEvent.input(pasted.getByRole("textbox", { name: "Amount" }), {
        target: { value: "1.000" },
      });

      expect(readingsOf(pasted.getByRole("alert"))).toStrictEqual([
        "1 DUSK",
        "1000 DUSK",
      ]);
    });

    it("should say a link for another network is one, and fill in nothing", () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=0.15&memo=Factura+33&network=mainnet`);

      const { getByRole } = render(SendPage);
      const problem = getByRole("alert");

      // Both networks named, each as what it is: the link's, and the one the
      // wallet is on.
      expect(problem).toHaveTextContent(/\bfor Mainnet\b/);
      expect(problem).toHaveTextContent(/\bon Testnet\b/);
      expect(fieldsAre(getByRole)).toStrictEqual(["", "", ""]);
    });

    it.each([
      ["no recipient", "amount=0.15&memo=Factura+33"],
      ["an empty recipient", "to=&amount=0.15"],
      ["a network there's no file for", `to=${OTHER}&network=nowhere`],
    ])(
      "should say why a link with %s can't be read, and fill in nothing",
      (_, query) => {
        setNodeNetwork(networks.testnet);
        openLink(query);

        const { getByRole } = render(SendPage);

        expect(getByRole("alert")).toBeInTheDocument();
        expect(fieldsAre(getByRole)).toStrictEqual(["", "", ""]);
      },
    );

    it("should start the form over for another link while it shows, and keep what it filled in for Send without one, as Back does", async () => {
      setNodeNetwork(networks.testnet);
      openLink(`to=${OTHER}&amount=0.15`);

      const { getByRole } = render(SendPage);

      await act(() =>
        openAt(
          new URL(
            `http://localhost/some-base-path/dashboard/send?to=${OTHER}&amount=0.5`,
          ),
        ),
      );

      expect(fieldsAre(getByRole)[1]).toBe("0.5");

      await act(() =>
        openAt(new URL("http://localhost/some-base-path/dashboard/send")),
      );

      expect(fieldsAre(getByRole)).toStrictEqual([OTHER, "0.5", ""]);
    });
  });

  it("should pay from the public balance, or the shielded one for a shielded address, and say which", async () => {
    const { container, getByRole } = render(SendPage);
    const to = getByRole("textbox", { name: "To" });

    expect(available(container)).toHaveTextContent(PUBLIC_BALANCE);

    await fireEvent.input(to, {
      target: { value: currentProfile.address.toString() },
    });

    expect(available(container)).toHaveTextContent(SHIELDED_BALANCE);

    await fireEvent.input(to, {
      target: { value: currentProfile.account.toString() },
    });

    expect(available(container)).toHaveTextContent(PUBLIC_BALANCE);
  });

  it("should count out of Available and Max what the sends waiting to go out from that balance take, and say so", async () => {
    const public_ = currentProfile.account.toString();
    const shielded = currentProfile.address.toString();
    const answered = Promise.withResolvers();
    const waiting = (/** @type {string} */ from) => {
      const gate = sendGate();

      keepWaiting({
        address: OTHER,
        from,
        gate,
        lux: 10_000_000n,
        maxFee: 2_500_000n,
        operation: answered.promise,
        to: "Lena",
      });

      return gate;
    };
    const fromPublic = waiting(public_);
    const fromShielded = waiting(shielded);

    try {
      const { container, getByRole } = render(SendPage);
      const { gasLimit, gasPrice } = getGasSettings(
        "public-transfer",
        get(settingsStore),
        get(gasPriceStore),
      );
      const left = balance.unshielded.value - 12_500_000n;

      expect(available(container)).toHaveTextContent(duskFigure(left));

      await fireEvent.input(getByRole("textbox", { name: "To" }), {
        target: { value: OTHER },
      });
      await fireEvent.click(getByRole("button", { name: "Max" }));

      // All that's left, less the fee, and what's kept for later as ever.
      expect(getByRole("textbox", { name: "Amount" })).toHaveValue(
        formatDuskPlain(left - gasLimit * gasPrice - get(feeToKeep).lux),
      );

      // Handed over, it's counted out until the node took it.
      await act(() => fromPublic.handOver());
      await act(() => fromShielded.cancel());

      expect(available(container)).toHaveTextContent(
        duskFigure(balance.unshielded.value - 12_500_000n),
      );

      // Gone out, or called off: all of it again.
      answered.resolve(undefined);

      await vi.waitFor(() =>
        expect(available(container)).toHaveTextContent(PUBLIC_BALANCE),
      );
    } finally {
      fromPublic.cancel();
      fromShielded.cancel();
      answered.resolve(undefined);
    }
  });

  it("should pay from the public balance again when the recipient entered after a shielded one doesn't resolve, or is cleared", async () => {
    resolveDuskName.mockImplementation((name) =>
      Promise.resolve(
        name === "alice.dusk"
          ? { address: currentProfile.address.toString(), name }
          : { error: "not-registered", name },
      ),
    );

    const { container, findByRole, getByRole } = render(SendPage);

    /** @param {string} value */
    const enter = (value) =>
      fireEvent.input(getByRole("textbox", { name: "To" }), {
        target: { value },
      });

    await enter("alice.dusk");

    // Resolved to a shielded address: paid from the shielded balance.
    await vi.waitFor(() =>
      expect(available(container)).toHaveTextContent(SHIELDED_BALANCE),
    );

    await enter("bob.dusk");

    expect(await findByRole("alert")).toHaveTextContent(
      /(?<![\w.-])bob\.dusk\b/,
    );
    expect(available(container)).toHaveTextContent(PUBLIC_BALANCE);

    await enter(currentProfile.address.toString());

    expect(available(container)).toHaveTextContent(SHIELDED_BALANCE);

    await enter("");

    expect(available(container)).toHaveTextContent(PUBLIC_BALANCE);
  });

  it("should hide the balance it pays from, and what Max fills in, while balances are hidden", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    const { container, getByRole } = render(SendPage);
    const { gasLimit, gasPrice } = getGasSettings(
      "public-transfer",
      get(settingsStore),
      get(gasPriceStore),
    );
    // What Max fills in: all of it, less the fee and what's kept for later.
    const max =
      balance.unshielded.value - gasLimit * gasPrice - get(feeToKeep).lux;
    const amount = /** @type {HTMLInputElement} */ (
      getByRole("textbox", { name: "Amount" })
    );

    expect(container).not.toHaveTextContent(
      formatDusk(balance.unshielded.value, "en"),
    );

    await fireEvent.input(getByRole("textbox", { name: "To" }), {
      target: { value: OTHER },
    });
    await fireEvent.click(getByRole("button", { name: "Max" }));

    // No figure in the field, nor Max's anywhere, nor the balance's.
    expect(amount.value).not.toMatch(/\d/);
    expect(container).not.toHaveTextContent(formatDuskExact(max, "en"));
    expect(container).not.toHaveTextContent(
      formatDusk(balance.unshielded.value, "en"),
    );

    // An amount typed shows.
    await fireEvent.input(amount, { target: { value: "1" } });

    expect(amount).toHaveValue("1");
    expect(summaryRow(container, /amount/i)).toHaveTextContent(/^1 DUSK\b/);
  });

  describe("gas price", () => {
    /** Sozu's activation after a stake, waiting alone at 2. */
    const SOZU_ACTIVATION = [{ gasLimit: 6_000_000, gasPrice: "2" }];

    /**
     * A block's worth waiting in the node's mempool, each at `median`.
     *
     * @param {bigint} median
     */
    const blockFull = (median) =>
      Array.from({ length: 1_000 }, () => ({
        gasLimit: 2_500_000,
        gasPrice: String(median),
      }));

    /**
     * What waits in the node's mempool from now, as its GraphQL lists it.
     *
     * @param {Array<{ gasLimit: number, gasPrice: string }>} mempoolTxs
     */
    const nodeHolds = (mempoolTxs) =>
      vi
        .spyOn(networkStore, "connect")
        .mockResolvedValue(
          /** @type {any} */ ({ query: async () => ({ mempoolTxs }) }),
        );

    /** @param {HTMLElement} container */
    const reviewFee = (container) =>
      container.querySelector(".gas-fee__amount-value")?.textContent;

    /** @param {bigint} price */
    const feeAt = (price) =>
      formatDuskPlain(
        getGasSettings("public-transfer", get(settingsStore), price).gasLimit *
          price,
      );

    afterEach(async () => {
      // The lowest again, as the other tests start from.
      nodeHolds([]);
      await gasPriceStore.refresh();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("should start from the price both wallets pick: the lowest while what waits fits in the next block, as Sozu's activation alone at 2, else the median up to five times the lowest, saying the network is busy over it", async () => {
      for (const [mempool, price, isBusy] of /** @type {const} */ ([
        [blockFull(900n), 5n, true],
        [blockFull(2n), 2n, false],
        [SOZU_ACTIVATION, 1n, false],
      ])) {
        nodeHolds([...mempool]);
        await gasPriceStore.refresh();

        const { container, getByRole, queryByText } = render(SendPage);

        await fireEvent.input(getByRole("textbox", { name: "To" }), {
          target: { value: OTHER },
        });
        await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
          target: { value: "1" },
        });
        await fireEvent.click(getByRole("button", { name: "Review" }));

        expect(reviewFee(container)).toBe(feeAt(price));

        if (isBusy) {
          expect(queryByText(GAS_PRICE_BUSY)).toBeInTheDocument();
        } else {
          expect(queryByText(GAS_PRICE_BUSY)).toBeNull();
        }

        cleanup();
      }
    });

    it("should open its Review with the price read within the last half minute, reading it again while the form shows, as the extension does as a Review opens", async () => {
      nodeHolds(SOZU_ACTIVATION);
      await gasPriceStore.refresh();
      vi.useFakeTimers({
        toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
      });

      const { container, getByRole, queryByText } = render(SendPage);

      await fireEvent.input(getByRole("textbox", { name: "To" }), {
        target: { value: OTHER },
      });
      await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
        target: { value: "1" },
      });

      // The mempool fills while the form shows: read again within half a
      // minute, and the form takes it.
      nodeHolds(blockFull(900n));
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      await fireEvent.click(getByRole("button", { name: "Review" }));

      expect(reviewFee(container)).toBe(feeAt(5n));
      expect(queryByText(GAS_PRICE_BUSY)).toBeInTheDocument();
    });
  });

  it("should start a transfer from the default gas limit of its recipient", async () => {
    const { container, getByRole } = render(SendPage);
    const maxFee = () =>
      container.querySelector(".gas-fee__amount-value")?.textContent;
    const to = getByRole("textbox", { name: "To" });

    await fireEvent.input(to, {
      target: { value: currentProfile.account.toString() },
    });

    expect(maxFee()).toBe("0.0025");

    await fireEvent.input(to, {
      target: { value: currentProfile.address.toString() },
    });

    expect(maxFee()).toBe("0.05");
  });

  it("should keep the user's gas limit when other settings change", async () => {
    const { container, getByLabelText, getByRole } = render(SendPage);

    await fireEvent.input(getByRole("textbox", { name: "To" }), {
      target: { value: currentProfile.account.toString() },
    });
    await fireEvent.click(getByRole("button", { name: "Edit" }));
    await fireEvent.input(getByLabelText(/gas limit/i), {
      target: { value: "3000000" },
    });
    await act(() =>
      settingsStore.update((settings) => ({ ...settings, userId: "someone" })),
    );

    expect(container.querySelector(".gas-fee__amount-value")?.textContent).toBe(
      "0.003",
    );
  });

  // Chen's: nothing said on Review of a stranger's "URGENT: wallet
  // suspended" memos of three and six days before, as they were further
  // back than the page History had shown, while Lena's of yesterday was.
  it("should say on Review what an address sent this profile, from all of the history, not only the page History has shown", async () => {
    const day = 86_400_000;
    const URGENT = "URGENT: wallet suspended - pay now to restore";
    const fromStranger = rowOf({
      amount: "1000000",
      blockHeight: 4_800_000,
      direction: "in",
      from: OTHER,
      hash: "c3".repeat(32),
      memo: URGENT,
      status: "executed",
      timestamp: Date.now() - 3 * day,
    });
    // Another stranger's, since: never said as this address's.
    const fromSomeoneElse = rowOf({
      amount: "1000000",
      blockHeight: 4_800_100,
      direction: "in",
      from: "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um",
      hash: "c4".repeat(32),
      memo: "Lunch money, thanks",
      status: "executed",
      timestamp: Date.now() - day,
    });

    history.whole?.set({
      failed: false,
      reading: false,
      rows: [fromSomeoneElse, fromStranger],
      whole: true,
    });
    openAt(
      new URL(
        `http://localhost/some-base-path/dashboard/send?to=${OTHER}&amount=0.01`,
      ),
    );

    try {
      const { container, getByRole } = render(SendPage);

      await fireEvent.click(getByRole("button", { name: "Review" }));

      const note = getByRole("note");

      // What the address under To sent, whole and alone in its own element,
      // apart from what the wallet says of it; nothing someone else sent.
      expect(note.querySelector(".memo-text")?.textContent).toBe(URGENT);
      expect(note).not.toHaveTextContent("Lunch money");
      expect(
        summaryRow(container, /^to$/i).querySelector(".full-address")
          ?.textContent,
      ).toBe(OTHER);
    } finally {
      history.whole?.set({
        failed: false,
        reading: false,
        rows: [],
        whole: true,
      });
    }
  });

  it("should open with the recipient in the address, as from Send again or a contact", () => {
    openAt(
      new URL(`http://localhost/some-base-path/dashboard/send?to=${OTHER}`),
    );

    const { getByRole } = render(SendPage);

    expect(getByRole("textbox", { name: "To" })).toHaveValue(OTHER);
  });

  it("should start again with another recipient the address asks for while the page shows", async () => {
    openAt(
      new URL(`http://localhost/some-base-path/dashboard/send?to=${OTHER}`),
    );

    const { getByRole } = render(SendPage);
    // Another account, a key as any a link pays.
    const another =
      "oUgxBUWEPyFAekXW9T2UdJBcMF7xAuBfstrCX8ATXFk7MusqddFGoq2LN9euCbwVuXpSM5rGLKNUb6NVPFUVM5g4pA6CnXjNfNVBiy91NcH9eBVcdcG1eYUaKWQSYQ9t2um";

    await act(() =>
      openAt(
        new URL(`http://localhost/some-base-path/dashboard/send?to=${another}`),
      ),
    );

    expect(getByRole("textbox", { name: "To" })).toHaveValue(another);
  });
});
