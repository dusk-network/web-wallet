import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/svelte";
import { get } from "svelte/store";
import { goto } from "$app/navigation";

import { formatTime } from "@dusk-network/networks/format";
import { shortenAddress } from "$lib/dusk/string";
import { toastList, toastTimer } from "$lib/dusk/components/Toast/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import { settingsStore, walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { hydrateRequests, requestsStore } from "$lib/payment-requests";
import { parsePaymentLink } from "@dusk-network/app-core/payment-links";
import { networks } from "@dusk-network/networks";

import Receive from "../+page.svelte";

vi.useFakeTimers();

const { getPrimaryName } = vi.hoisted(() => ({ getPrimaryName: vi.fn() }));

const history = vi.hoisted(() => ({
  /**
   * Whether what's further back is read still, or couldn't be.
   *
   * @type {import("svelte/store").Writable<{ failed: boolean, reading: boolean }> | null}
   */
  flags: null,
  /**
   * Rows of the history further back than the page History shows.
   *
   * @type {import("svelte/store").Writable<any[]> | null}
   */
  older: null,
  refresh: vi.fn(() => Promise.resolve()),
  /** @type {import("svelte/store").Writable<any> | null} */
  state: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  const { derived, writable } = await import("svelte/store");

  history.flags = writable({ failed: false, reading: false });
  history.older = writable([]);
  history.state = writable({ hasMore: false, rows: [] });

  return {
    .../** @type {object} */ (await importOriginal()),
    activityState: history.state,
    currentActivity: () => ({ refresh: history.refresh }),
    // All of the history: the page shown, then what's further back.
    wholeActivity: derived(
      [history.state, history.older, history.flags],
      ([{ rows }, older, flags]) => ({
        ...flags,
        rows: [...rows, ...older],
        whole: !flags.failed && !flags.reading,
      }),
    ),
  };
});

/**
 * What each QR code drawn holds, by the picture made of it, and the pictures
 * still being made: as the library is asked to draw them.
 */
const qr = vi.hoisted(() => ({
  /** @type {Map<string, string>} */
  encoded: new Map(),
  /** @type {Set<Promise<string>>} */
  pending: new Set(),
}));

vi.mock("qrcode", async (importOriginal) => {
  /** @type {any} */
  const original = await importOriginal();

  return {
    ...original,
    /**
     * @param {string} text
     * @param {object} options
     */
    toDataURL: async (text, options) => {
      /** @type {Promise<string>} */
      const making = original.toDataURL(text, options);

      qr.pending.add(making);

      try {
        const picture = await making;

        qr.encoded.set(picture, text);

        return picture;
      } finally {
        qr.pending.delete(making);
      }
    },
  };
});

vi.mock("$lib/dusk-domains", () => ({ getPrimaryName }));

vi.mock("$app/navigation", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  goto: vi.fn(() => Promise.resolve()),
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
  /** @type {WalletStore} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      ...mockedWalletStore,
    },
  };
});

/**
 * When a payment of a request paid more than once came in, as its list says
 * it: to the second.
 *
 * @param {number} ms
 */
const paidAt = (ms) => formatTime(ms, { locale: "en", seconds: true });

/**
 * A figure on its own, never the end or start of a longer one: "0.15 DUSK"
 * never as part of "10.15 DUSK", "2:05:01" never of "12:05:01".
 *
 * @param {string} text
 */
const figure = (text) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d])`);
};

/**
 * The time of day of `paidAt`, to the second, as any sentence about the
 * payment gives it.
 *
 * @param {number} ms
 */
const clockOf = (ms) =>
  figure(/** @type {string} */ (paidAt(ms).match(/\d{1,2}:\d{2}:\d{2}/)?.[0]));

describe("Receive", () => {
  const currentProfile = /** @type {Profile} */ (
    get(walletStore).currentProfile
  );
  const expectedAddress = currentProfile.address.toString();
  const expectedAccount = currentProfile.account.toString();

  /** The address the page shows, in full. */
  const shownAddress = () =>
    document.querySelector(".receive__full-address")?.textContent;

  // The QR code shows once its PNG is made, which Node deflates on its
  // threadpool: running the fake timers doesn't wait for that.
  const qrCodeDrawn = () =>
    vi.waitFor(() => screen.getByRole("img", { name: /^QR code for your/ }));

  /**
   * What the QR code on screen holds, once all it was asked to draw is
   * drawn: never what a picture made before shows.
   */
  const qrHolds = async () => {
    while (qr.pending.size) {
      await Promise.allSettled([...qr.pending]);
    }

    await vi.advanceTimersByTimeAsync(0);

    return qr.encoded.get(
      document.querySelector("img.receive__qr")?.getAttribute("src") ?? "",
    );
  };

  beforeEach(() => {
    getPrimaryName.mockResolvedValue("");
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    getPrimaryName.mockReset();
  });

  afterAll(() => {
    vi.doUnmock("$lib/dusk-domains");
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
    vi.useRealTimers();
  });

  it("should render the receive page with a choice to switch from public to shielded address", async () => {
    const { getByRole } = render(Receive);

    await vi.runAllTimersAsync();
    await qrCodeDrawn();

    expect(getByRole("radiogroup")).toBeInTheDocument();
    expect(shownAddress()).toBe(expectedAccount);
    expect(await qrHolds()).toBe(expectedAccount);
  });

  it("should copy the full address shown, public or shielded, from its field", async () => {
    const { getByRole } = render(Receive);

    await vi.runAllTimersAsync();
    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expectedAccount,
    );

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();
    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expectedAddress,
    );
  });

  it("should show the shielded address when the user makes such choice", async () => {
    const { getByRole } = render(Receive);

    await vi.runAllTimersAsync();

    expect(shownAddress()).toBe(expectedAccount);

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();
    await qrCodeDrawn();

    expect(shownAddress()).toBe(expectedAddress);
    expect(await qrHolds()).toBe(expectedAddress);
  });

  describe("Request payment", () => {
    const REQUESTS = `${CONFIG.LOCAL_STORAGE_APP_KEY}-payment-requests`;

    // A link is only made for a key: the bridge's on testnet stands in.
    const ACCOUNT =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
    const before = mockedWalletStore.getMockedStoreValue();

    beforeEach(() => {
      localStorage.removeItem(REQUESTS);
      hydrateRequests();
      setNodeNetwork(networks.testnet);
      mockedWalletStore.setMockedStoreValue({
        ...before,
        currentProfile: /** @type {any} */ ({
          account: ACCOUNT,
          address: expectedAddress,
        }),
      });
    });

    afterEach(() => {
      mockedWalletStore.setMockedStoreValue(before);
      setNodeNetwork(null);
      localStorage.removeItem(REQUESTS);
      Reflect.deleteProperty(navigator, "share");
    });

    /** @param {string} name */
    const openRequest = async (name = "Request payment") => {
      const summary = screen.getByText(name);

      await fireEvent.click(summary);
      /** @type {HTMLDetailsElement} */ (summary.closest("details")).open =
        true;
      await fireEvent(
        /** @type {HTMLElement} */ (summary.closest("details")),
        new Event("toggle"),
      );
    };

    /**
     * @param {string} name
     * @param {string} value
     */
    const type = (name, value) =>
      fireEvent.input(screen.getByRole("textbox", { name }), {
        target: { value },
      });

    /**
     * The link in what Copy or Share gave, after a line saying what's asked.
     *
     * @param {string | undefined} text
     */
    const linkIn = (text) => String(text).match(/https:\/\/\S+/)?.[0] ?? "";

    /**
     * A line of a request's picture ending with the address it pays, as
     * shortened there.
     *
     * @param {string} address
     */
    const paying = (address) =>
      expect.stringMatching(new RegExp(`(^|\\s)${shortenAddress(address)}$`));

    /**
     * A listed request's state, as its badge is marked: "paid", "waiting",
     * "check" or "again" (paid more than once); null where it shows what
     * came in for one of any amount.
     *
     * @param {Element} card
     */
    const stateOf = (card) =>
      card
        .querySelector(".requests__state")
        ?.className.match(/requests__state--(\w+)/)?.[1] ?? null;

    it("should make a link the Send of any wallet reads, with the amount and memo asked, and keep it on the list as it's copied", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "0.15");
      await type("Memo (optional)", " Factura 33 ");
      await vi.runAllTimersAsync();

      expect(get(requestsStore)).toStrictEqual([]);
      // The QR holds the request, not the address alone.
      expect(parsePaymentLink(await qrHolds())).toMatchObject({
        amountDusk: "0.15",
        chainId: "dusk:2",
        memo: "Factura 33",
        to: ACCOUNT,
      });

      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      const [[copied]] = vi.mocked(navigator.clipboard.writeText).mock.calls;
      const [said] = copied.split("\n");

      // What it asks in a line, as the extension gives it, then the link.
      expect(said).toMatch(figure("0.15 DUSK"));
      expect(said).toMatch(/\bTestnet\b/);
      expect(said).toContain("Factura 33");
      expect(linkIn(copied)).toMatch(
        /^https:\/\/apps\.testnet\.dusk\.network\/wallet\/dashboard\/send\?/,
      );
      expect(parsePaymentLink(linkIn(copied))).toMatchObject({
        amountDusk: "0.15",
        chainId: "dusk:2",
        memo: "Factura 33",
        to: ACCOUNT,
      });
      expect(get(requestsStore)).toMatchObject([
        {
          lux: "150000000",
          memo: "Factura 33",
          network: "testnet",
          to: ACCOUNT,
        },
      ]);
    });

    // What's scanned: the QR code holds the request shown and copied, drawn
    // anew as it changes, never one from before.
    it("should hold in its QR code exactly the request shown and copied, anew as its amount, memo or address changes", async () => {
      /** The request the QR code on screen holds, as a wallet reads it. */
      const held = async () => parsePaymentLink(await qrHolds());

      render(Receive);
      await vi.runAllTimersAsync();

      // Nothing asked: the address alone, as shown.
      expect(await qrHolds()).toBe(ACCOUNT);

      await openRequest();
      await type("Amount (optional)", "0.15");
      await type("Memo (optional)", "Factura 33");
      await vi.runAllTimersAsync();
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      const asked = {
        amountDusk: "0.15",
        chainId: "dusk:2",
        memo: "Factura 33",
        to: ACCOUNT,
      };

      expect(
        parsePaymentLink(
          linkIn(vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0]),
        ),
      ).toMatchObject(asked);
      expect(await held()).toMatchObject(asked);

      // Another amount, another memo, then the shielded address: each drawn
      // anew.
      await type("Amount (optional)", "0.2");

      expect(await held()).toMatchObject({ ...asked, amountDusk: "0.2" });

      await type("Memo (optional)", "Factura 34");

      expect(await held()).toMatchObject({
        ...asked,
        amountDusk: "0.2",
        memo: "Factura 34",
      });

      await fireEvent.click(screen.getByRole("radio", { checked: false }));

      expect(shownAddress()).toBe(expectedAddress);
      expect(await held()).toMatchObject({
        ...asked,
        amountDusk: "0.2",
        memo: "Factura 34",
        to: expectedAddress,
      });

      // Nothing asked again: the address alone.
      await type("Amount (optional)", "");
      await type("Memo (optional)", "");

      expect(await qrHolds()).toBe(expectedAddress);
    });

    it("should say what a request comes to in the person's currency on mainnet, with the price's time, its link asking DUSK, and nothing on testnet", async () => {
      const prices = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            market_data: {
              current_price: { eur: 0.5 },
              // Today's: a day's time says its day too.
              last_updated: new Date().toISOString(),
            },
          }),
      }));

      vi.stubGlobal("fetch", prices);
      settingsStore.update((store) => ({ ...store, currency: "EUR" }));

      try {
        // Test DUSK has no value: nothing asked, nothing said.
        render(Receive);
        await vi.runAllTimersAsync();
        await openRequest();
        await type("Amount (optional)", "2");
        await vi.runAllTimersAsync();

        expect(screen.queryByText(/€/)).toBeNull();
        expect(prices).not.toHaveBeenCalled();
        cleanup();

        setNodeNetwork(networks.mainnet);
        render(Receive);
        // Not all: the price, read again every five minutes while the amount
        // kept from before shows, always has another to run.
        await vi.runOnlyPendingTimersAsync();
        await openRequest();
        await type("Amount (optional)", "2");

        await vi.waitFor(() =>
          expect(screen.getByText(figure("€1.00"))).toBeInTheDocument(),
        );

        // The link asks what it asked: DUSK.
        await fireEvent.click(
          screen.getByRole("button", { name: "Copy request" }),
        );
        await vi.advanceTimersByTimeAsync(0);

        const [copied] = vi
          .mocked(navigator.clipboard.writeText)
          .mock.calls.at(-1) ?? [""];

        expect(parsePaymentLink(linkIn(copied))).toMatchObject({
          amountDusk: "2",
        });
        expect(copied).not.toMatch(/eur|€/i);
      } finally {
        vi.unstubAllGlobals();
        settingsStore.reset();
      }
    });

    it("should say what's wrong with an amount, offer no link for it, and offer none with nothing asked", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();

      expect(screen.queryByRole("button", { name: "Copy request" })).toBe(null);

      await type("Amount (optional)", "1.2345678901");
      await vi.runAllTimersAsync();

      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: "Amount (optional)" }),
      ).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByRole("button", { name: "Copy request" })).toBe(null);
    });

    it("should ask which amount is meant of one that could be either of two, with a button for each, and make the request for the one picked", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "2.125");
      await vi.runAllTimersAsync();

      expect(screen.getByRole("alert")).toHaveTextContent(figure("2.1250"));
      expect(screen.getByRole("alert")).toHaveTextContent(figure("2125"));
      expect(screen.queryByRole("button", { name: "Copy request" })).toBe(null);

      await fireEvent.click(
        screen.getByRole("button", { name: "2.1250 DUSK" }),
      );
      await vi.runAllTimersAsync();

      expect(
        screen.getByRole("textbox", { name: "Amount (optional)" }),
      ).toHaveValue("2.1250");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Copy request" }),
      ).toBeInTheDocument();
    });

    it("should show a memo with a hidden character as a payer's wallet will, with its codes, before its link is copied", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Memo (optional)", "r20 \u202Eqer");
      await vi.runAllTimersAsync();

      // The field draws it turned around: under it, it's said as it is.
      const flag = /** @type {HTMLElement} */ (
        screen.getByText("r20 \\u202eqer").closest(".request__flag")
      );

      expect(flag.querySelector(".memo-text__note")).not.toBeNull();

      await type("Memo (optional)", "Factura 33");
      await vi.runAllTimersAsync();

      expect(document.querySelector(".request__flag")).toBeNull();
    });

    it("should ask for the shielded address on its tab", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "1");
      await fireEvent.click(screen.getByRole("radio", { checked: false }));
      await vi.runAllTimersAsync();
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      const copied = vi.mocked(navigator.clipboard.writeText).mock
        .lastCall?.[0];

      expect(parsePaymentLink(linkIn(copied))).toMatchObject({
        to: expectedAddress,
      });
    });

    // Sofía's and Nandini's: with a request filled in, the first of two
    // buttons called Share gave a client the bare address.
    it("should share the address alone by Share address, and the request by Share request, keeping the request only once it's shared", async () => {
      const share = vi.fn().mockResolvedValue(undefined);

      Object.assign(navigator, { share });
      render(Receive);
      await vi.runAllTimersAsync();
      await fireEvent.click(
        screen.getByRole("button", { name: "Share address" }),
      );
      await vi.runAllTimersAsync();

      expect(share).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: ACCOUNT }),
      );
      expect(get(requestsStore)).toStrictEqual([]);

      await openRequest();
      await type("Amount (optional)", "2");
      await vi.advanceTimersByTimeAsync(0);

      // By the address, still the address alone.
      await fireEvent.click(
        screen.getByRole("button", { name: "Share address" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(share).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: ACCOUNT }),
      );
      expect(get(requestsStore)).toStrictEqual([]);

      await fireEvent.click(
        screen.getByRole("button", { name: "Share request" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      // The request in a line, then its link, as text alone.
      const [sharedLine] = share.mock.lastCall?.[0].text.split("\n") ?? [];

      expect(sharedLine).toMatch(figure("2 DUSK"));
      expect(sharedLine).toMatch(/\bTestnet\b/);
      expect(
        parsePaymentLink(linkIn(share.mock.lastCall?.[0].text)),
      ).toMatchObject({
        amountDusk: "2",
        to: ACCOUNT,
      });
      expect(get(requestsStore)).toMatchObject([{ lux: "2000000000" }]);

      // The sheet closed unused keeps nothing new.
      share.mockRejectedValueOnce(
        Object.assign(new Error("closed"), { name: "AbortError" }),
      );
      await type("Amount (optional)", "3");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Share request" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(get(requestsStore)).toHaveLength(1);

      // In the list, each its own.
      await fireEvent.click(
        screen.getByRole("button", { name: "Share the request for 2 DUSK" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(share.mock.lastCall?.[0].text.split("\n")[0]).toMatch(
        figure("2 DUSK"),
      );
      expect(
        parsePaymentLink(linkIn(share.mock.lastCall?.[0].text)),
      ).toMatchObject({
        amountDusk: "2",
        to: ACCOUNT,
      });
    });

    it("should write what a request asks under its QR in the picture: what it is, the amount, the memo and whom it pays", async () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const written = vi.spyOn(CanvasRenderingContext2D.prototype, "fillText");

      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "0.05");
      await type("Memo (optional)", "Factura 33");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" }),
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      /** The picture's lines, each as written under its QR code. */
      const lines = () => written.mock.calls.map(([text]) => text);

      // Each a line of its own: the network, the amount, the memo, and the
      // address it pays, at the end of its line.
      expect(lines()).toContainEqual(expect.stringMatching(/\bTestnet\b/));
      expect(lines()).toContain("0.05 DUSK");
      expect(lines()).toContain("Factura 33");
      expect(lines()).toContainEqual(paying(ACCOUNT));

      // Mainnet's is the one that names no network.
      setNodeNetwork(networks.mainnet);
      written.mockClear();
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" }),
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(2));

      expect(lines()).toContain("0.05 DUSK");
      expect(lines().join("\n")).not.toMatch(/testnet|mainnet/i);

      click.mockRestore();
      written.mockRestore();
    });

    it("should write and keep what was asked when Download QR was pressed, though it's changed before the picture is made", async () => {
      /** @type {(name: string) => void} */
      let named = () => {};

      getPrimaryName.mockReturnValue(
        new Promise((resolve) => {
          named = resolve;
        }),
      );

      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const written = vi.spyOn(CanvasRenderingContext2D.prototype, "fillText");

      render(Receive);
      await vi.advanceTimersByTimeAsync(0);
      await openRequest();
      await type("Amount (optional)", "0.05");
      await type("Memo (optional)", "Factura 33");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" }),
      );
      await type("Memo (optional)", "Factura 34");
      await vi.advanceTimersByTimeAsync(0);
      named("");
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(written.mock.calls.map(([text]) => text)).toContain("Factura 33");
      expect(written.mock.calls.map(([text]) => text)).not.toContain(
        "Factura 34",
      );
      expect(get(requestsStore)).toMatchObject([{ memo: "Factura 33" }]);

      click.mockRestore();
      written.mockRestore();
    });

    it("should name in the picture the address its code pays, though the shielded one is chosen before it's made", async () => {
      /** @type {(name: string) => void} */
      let named = () => {};

      getPrimaryName.mockReturnValue(
        new Promise((resolve) => {
          named = resolve;
        }),
      );

      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const written = vi.spyOn(CanvasRenderingContext2D.prototype, "fillText");

      render(Receive);
      await vi.advanceTimersByTimeAsync(0);
      await openRequest();
      await type("Amount (optional)", "0.05");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" }),
      );
      await fireEvent.click(screen.getByRole("radio", { checked: false }));
      await vi.advanceTimersByTimeAsync(0);
      named("");
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(written.mock.calls.map(([text]) => text)).toContainEqual(
        paying(ACCOUNT),
      );
      expect(get(requestsStore)).toMatchObject([{ to: ACCOUNT }]);

      click.mockRestore();
      written.mockRestore();
    });

    // Q03, Sofía's, Nandini's, Marek's and Chen's: Copy on a request paid
    // already, or paid twice, said only Copied, and Share sent a fresh "asks
    // you to pay". Round 32's note was a toast from the form alone: the
    // list's own Copy link and Share never checked, and nothing stayed to
    // be read.
    it("should say Paid with when beside a paid request's Copy and Share, and ask on its card before either gives it out again, never in a toast", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      const PAYER =
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
      const at = Date.now() - 60_000;
      /** @param {Record<string, unknown>} fields */
      const row = (fields) => ({
        category: "received",
        counterparty: PAYER,
        memo: "Factura 2026-101",
        privacy: "public",
        status: "executed",
        value: 30_000_000n,
        ...fields,
      });

      Object.assign(navigator, { share });
      toastTimer.set(5000);
      toastList.set([]);
      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "once",
            lux: "13000000",
            memo: "Factura 2026-071",
            network: "testnet",
            to: ACCOUNT,
          },
          {
            at,
            id: "twice",
            lux: "30000000",
            memo: "Factura 2026-101",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [
          row({
            hash: "ab".repeat(32),
            memo: "Factura 2026-071",
            time: at + 500,
            value: 13_000_000n,
          }),
          row({ hash: "cd".repeat(32), time: at + 1500 }),
          row({ hash: "ef".repeat(32), time: at + 2500 }),
        ],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const [once, twice] = screen.getAllByRole("listitem");
      /** @param {HTMLElement} card */
      const actionsOf = (card) =>
        /** @type {HTMLElement} */ (card.querySelector(".requests__actions"));

      // On the card, beside its Copy and Share: Paid, with when; the one
      // paid twice, when first.
      expect(stateOf(once)).toBe("paid");
      expect(
        actionsOf(once).querySelector(".requests__paid"),
      ).toHaveTextContent(clockOf(at + 500));
      expect(stateOf(twice)).toBe("again");
      expect(
        actionsOf(twice).querySelector(".requests__paid"),
      ).toHaveTextContent(clockOf(at + 1500));

      // Copy request asks first, on the card: nothing copied yet.
      await fireEvent.click(
        screen.getByRole("button", {
          name: "Copy request for 0.013 DUSK, Factura 2026-071",
        }),
      );

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(once.querySelector("[role=alert]")).toHaveTextContent(
        clockOf(at + 500),
      );

      // Cancel: nothing given out, nothing asked any more.
      await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(once.querySelector("[role=alert]")).toBeNull();
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();

      // Copy anyway: what Share gives, a line saying what it asks, then its
      // link, as the request's own Copy request gave it (Sofía's and
      // Chen's: a bare link, while Share gave the message).
      await fireEvent.click(
        screen.getByRole("button", {
          name: "Copy request for 0.013 DUSK, Factura 2026-071",
        }),
      );
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy anyway" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      const copied = String(
        vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0],
      );

      const [copiedLine] = copied.split("\n");

      expect(copiedLine).toMatch(figure("0.013 DUSK"));
      expect(copiedLine).toContain("Factura 2026-071");
      expect(parsePaymentLink(linkIn(copied))).toMatchObject({
        amountDusk: "0.013",
        memo: "Factura 2026-071",
      });
      expect(once.querySelector("[role=alert]")).toBeNull();

      // Share on the one paid twice: asked first, with when it was first paid.
      await fireEvent.click(
        screen.getByRole("button", {
          name: "Share the request for 0.03 DUSK, Factura 2026-101",
        }),
      );

      expect(share).not.toHaveBeenCalled();
      expect(twice.querySelector("[role=alert]")).toHaveTextContent(
        clockOf(at + 1500),
      );

      await fireEvent.click(
        screen.getByRole("button", { name: "Share anyway" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(share).toHaveBeenCalledOnce();

      const [sharedLine] = share.mock.lastCall?.[0].text.split("\n") ?? [];

      expect(sharedLine).toMatch(figure("0.03 DUSK"));
      expect(sharedLine).toContain("Factura 2026-101");
      expect(
        parsePaymentLink(linkIn(share.mock.lastCall?.[0].text)),
      ).toMatchObject({ amountDusk: "0.03", memo: "Factura 2026-101" });
      expect(get(toastList)).toStrictEqual([]);

      toastTimer.set(0);
    });

    it("should keep one request for what's asked again once it's paid, its QR and link the same, and ask under Copy request, Share request and Download QR before they give it out again", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      Object.assign(navigator, { share });
      toastTimer.set(5000);
      toastList.set([]);
      const at = Date.now() - 60_000;

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "invoice",
            lux: "13000000",
            memo: "Factura 2026-071",
            network: "testnet",
            paid: { at: at + 500, hash: "ab".repeat(32), lux: "13000000" },
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      render(Receive);
      // Not all: the list, with a request on it, always has another look to
      // run.
      await vi.runOnlyPendingTimersAsync();
      await openRequest();
      await type("Amount (optional)", "0.013");
      await type("Memo (optional)", "Factura 2026-071");
      await vi.advanceTimersByTimeAsync(0);

      // Asked with when it was paid.
      const asked = clockOf(at + 500);
      const question = () => document.querySelector(".request [role=alert]");

      // Copy request: asked under it first.
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" }),
      );

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(question()).toHaveTextContent(asked);

      await fireEvent.click(
        screen.getByRole("button", { name: "Copy anyway" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      const [[copied]] = vi.mocked(navigator.clipboard.writeText).mock.calls;

      expect(parsePaymentLink(linkIn(copied))).toMatchObject({
        amountDusk: "0.013",
        memo: "Factura 2026-071",
        to: ACCOUNT,
      });
      expect(get(requestsStore).map(({ id }) => id)).toStrictEqual(["invoice"]);
      expect(question()).toBeNull();

      // Share request: the same, and Cancel shares nothing.
      await fireEvent.click(
        screen.getByRole("button", { name: "Share request" }),
      );

      expect(question()).toHaveTextContent(asked);

      await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(share).not.toHaveBeenCalled();
      expect(question()).toBeNull();

      // Download QR, as the QR holds it: asked under it first.
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(click).not.toHaveBeenCalled();
      expect(
        document.querySelector(".address-actions [role=alert]"),
      ).toHaveTextContent(asked);

      await fireEvent.click(
        screen.getByRole("button", { name: "Download anyway" }),
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(get(requestsStore).map(({ id }) => id)).toStrictEqual(["invoice"]);
      expect(screen.getAllByRole("listitem")).toHaveLength(1);

      // Another, not paid: nothing asked.
      await type("Memo (optional)", "Factura 2026-072");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(question()).toBeNull();
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
      expect(get(requestsStore)).toHaveLength(2);
      // Never a toast.
      expect(get(toastList)).toStrictEqual([]);

      click.mockRestore();
      toastTimer.set(0);
    });

    // Then Sofía's: left open, the list said Paid for minutes after a second
    // payment, as it stopped looking once the request was paid.
    it("should look for what comes in while a request shows, say Paid once a payment has its amount and memo, and Paid twice once another comes in, the list left open", async () => {
      const at = Date.now() - 1000;
      /** @param {string} hash @param {number} time */
      const payment = (hash, time) => ({
        category: "received",
        hash,
        memo: "Factura 33",
        privacy: "public",
        status: "executed",
        time,
        value: 150_000_000n,
      });

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "open",
            lux: "150000000",
            memo: "Factura 33",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.refresh.mockClear();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      expect(history.refresh).toHaveBeenCalledOnce();
      expect(stateOf(screen.getByRole("listitem"))).toBe("waiting");

      await vi.advanceTimersByTimeAsync(30_000);

      expect(history.refresh).toHaveBeenCalledTimes(2);

      history.state?.set({
        hasMore: false,
        rows: [payment("ab".repeat(32), at + 500)],
      });
      await vi.advanceTimersByTimeAsync(0);

      const line = () =>
        screen.getByRole("listitem").querySelector(".requests__line");

      // Paid by a payment of its amount and memo, and when.
      expect(stateOf(screen.getByRole("listitem"))).toBe("paid");
      expect(line()).toHaveTextContent(figure("0.15 DUSK"));
      expect(line()).toHaveTextContent(clockOf(at + 500));
      // It stays paid with its payment out of what's read, and what it paid.
      expect(get(requestsStore)[0].paid).toStrictEqual({
        at: at + 500,
        hash: "ab".repeat(32),
        lux: "150000000",
      });

      // Paid, it's still looked for: the history has a second payment at
      // the next read, half a minute on, and the list says so.
      history.refresh.mockClear();
      history.refresh.mockImplementationOnce(async () => {
        history.state?.set({
          hasMore: false,
          rows: [
            payment("ab".repeat(32), at + 500),
            payment("cd".repeat(32), at + 900),
          ],
        });
      });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(history.refresh).toHaveBeenCalledOnce();
      expect(stateOf(screen.getAllByRole("listitem")[0])).toBe("again");

      // Not with the page gone.
      cleanup();
      history.refresh.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(history.refresh).not.toHaveBeenCalled();
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should say a request paid further back than the page History has shown is paid, from all of the history", async () => {
      const at = Date.now() - 5 * 86_400_000;

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "old",
            lux: "150000000",
            memo: "Factura 12",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      // The page History shows: fifty payments since, none of them its.
      history.state?.set({
        hasMore: true,
        rows: Array.from({ length: 50 }, (_, i) => ({
          category: "received",
          hash: (i + 1).toString(16).padStart(64, "0"),
          memo: "",
          privacy: "public",
          status: "executed",
          time: Date.now() - i * 1000,
          value: 1_000_000n,
        })),
      });
      history.older?.set([
        {
          category: "received",
          hash: "ab".repeat(32),
          memo: "Factura 12",
          privacy: "public",
          status: "executed",
          time: at + 500,
          value: 150_000_000n,
        },
      ]);

      try {
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        expect(stateOf(screen.getByRole("listitem"))).toBe("paid");
      } finally {
        history.state?.set({ hasMore: false, rows: [] });
        history.older?.set([]);
      }
    });

    // Codex's, round 40: as what's further back than the page History has
    // shown was read, a request older than all of it said not paid yet
    // had come in, and Copy request asked nothing, though its payment may
    // be about to be found.
    it("should say it's checking, not that nothing came in, for a request older than the history read so far, while the rest of it is read", async () => {
      const at = Date.now() - 5 * 86_400_000;
      /** What its card says of what came in. */
      const said = () =>
        screen.getByRole("listitem").querySelector(".requests__line")
          ?.textContent;

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "old",
            lux: "150000000",
            memo: "Factura 12",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: true,
        rows: [
          {
            category: "received",
            hash: "01".repeat(32),
            memo: "",
            privacy: "public",
            status: "executed",
            time: Date.now() - 1000,
            value: 1_000_000n,
          },
        ],
      });
      history.flags?.set({ failed: false, reading: true });

      try {
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        expect(stateOf(screen.getByRole("listitem"))).toBe("waiting");
        expect(said()).toMatch(/checking/i);
        expect(said()).not.toMatch(/not paid yet/i);

        // All of it read: nothing of it came in.
        history.flags?.set({ failed: false, reading: false });
        await vi.advanceTimersByTimeAsync(0);

        expect(said()).toMatch(/not paid yet/i);
        expect(said()).not.toMatch(/checking/i);
      } finally {
        history.state?.set({ hasMore: false, rows: [] });
        history.flags?.set({ failed: false, reading: false });
      }
    });

    it("should say it's checking, not that nothing came in, while a payment to it from another profile here is looked for, two minutes at most", async () => {
      const at = Date.now() - 1000;
      const { awaitArrival, forgetArrivals } = await import("$lib/activity");
      /** What its card says of what came in. */
      const said = () =>
        screen.getByRole("listitem").querySelector(".requests__line")
          ?.textContent;

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "open",
            lux: "30000000",
            memo: "Chicken rice Fri",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();

      try {
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        expect(said()).toMatch(/not paid yet/i);

        // Sent from another profile here, and seen to go out: the history
        // doesn't have it yet.
        awaitArrival({ hash: "ab".repeat(32), to: ACCOUNT });
        await vi.advanceTimersByTimeAsync(0);

        expect(said()).toMatch(/checking/i);
        expect(said()).not.toMatch(/not paid yet/i);

        // In the history: what came in.
        history.state?.set({
          hasMore: false,
          rows: [
            {
              category: "received",
              hash: "ab".repeat(32),
              memo: "Chicken rice Fri",
              privacy: "public",
              status: "executed",
              time: at + 500,
              value: 30_000_000n,
            },
          ],
        });
        await vi.advanceTimersByTimeAsync(0);

        expect(stateOf(screen.getByRole("listitem"))).toBe("paid");
        cleanup();

        // One the history never has: checked for two minutes, no more.
        history.state?.set({ hasMore: false, rows: [] });
        localStorage.setItem(
          REQUESTS,
          JSON.stringify([
            {
              at,
              id: "open",
              lux: "30000000",
              memo: "Chicken rice Fri",
              network: "testnet",
              to: ACCOUNT,
            },
          ]),
        );
        hydrateRequests();
        awaitArrival({ hash: "cd".repeat(32), to: ACCOUNT });
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        expect(said()).toMatch(/checking/i);

        await vi.advanceTimersByTimeAsync(120_000);

        expect(said()).toMatch(/not paid yet/i);
      } finally {
        forgetArrivals();
        history.state?.set({ hasMore: false, rows: [] });
      }
    });

    it("should say a request paid twice in its badge, and list each payment with a way to send the second back", async () => {
      const PAYER =
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
      const at = Date.now() - 10_000;
      const row = (/** @type {Record<string, unknown>} */ fields) => ({
        category: "received",
        counterparty: PAYER,
        hash: "ab".repeat(32),
        memo: "Factura 43",
        privacy: "public",
        status: "executed",
        time: at + 500,
        value: 10_000_000n,
        ...fields,
      });

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "twice",
            lux: "10000000",
            memo: "Factura 43",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [row({}), row({ hash: "cd".repeat(32), time: at + 2500 })],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const [item] = screen.getAllByRole("listitem");

      expect(stateOf(item)).toBe("again");

      // Each payment; the second, to send back to whoever paid it.
      const payments = screen.getByRole("list", {
        name: "Payments for this request",
      });

      expect(payments.querySelectorAll(".requests__payment")).toHaveLength(2);
      expect(
        screen.getAllByRole("link", { name: /^Send back the payment of/ }),
      ).toHaveLength(1);

      // Send back on the line of the payment it sends back.
      expect(
        screen
          .getByRole("link", { name: /^Send back the payment of/ })
          .closest(".requests__payment"),
      ).toHaveTextContent(paidAt(at + 2500));

      const back = new URL(
        String(
          screen
            .getByRole("link", { name: /^Send back the payment of/ })
            .getAttribute("href"),
        ),
        "https://wallet.test",
      );
      const asked = parsePaymentLink(
        `https://wallet.test/some-base-path${back.pathname.replace(/^\/some-base-path/, "")}${back.search}`,
        { walletUrl: "https://wallet.test/some-base-path" },
      );

      expect(asked).toMatchObject({
        amountDusk: "0.01",
        memo: "Refund: Factura 43",
        to: PAYER,
      });
      history.state?.set({ hasMore: false, rows: [] });
    });

    // Sofía's: an old paid request listed 26 payments of its amount made for
    // other invoices, as "Also the same amount … with another memo".
    it("should list on a card only what else could be its: the same memo, and the same amount with another memo only while it isn't paid, three at most, each memo quoted safely", async () => {
      const at = Date.now() - 60_000;
      /** @param {number} n @param {Record<string, unknown>} fields */
      const row = (n, fields) => ({
        category: "received",
        hash: n.toString(16).padStart(64, "0"),
        privacy: "public",
        status: "executed",
        time: at + n * 1000,
        ...fields,
      });
      /** @param {Record<string, unknown>} request */
      const show = async (request, /** @type {any[]} */ rows) => {
        cleanup();
        localStorage.setItem(
          REQUESTS,
          JSON.stringify([
            { at, id: "asked", network: "testnet", to: ACCOUNT, ...request },
          ]),
        );
        hydrateRequests();
        history.state?.set({ hasMore: false, rows });
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        return /** @type {HTMLElement} */ (
          document.querySelector(".requests__item")
        );
      };

      // Paid: the same memo for another amount still could be its, the same
      // amount with another memo, other invoices' payments, can't.
      const paid = await show({ lux: "10000000", memo: "Factura 43" }, [
        row(1, { memo: "Factura 43", value: 10_000_000n }),
        row(2, { memo: "Factura 44", value: 10_000_000n }),
        row(3, { memo: "Factura 45", value: 10_000_000n }),
        row(4, { memo: "Factura 43", value: 20_000_000n }),
      ]);

      const paidLine = paid.querySelector(".requests__line")?.textContent ?? "";
      /**
       * One figure, then another, in the same sentence.
       *
       * @param {RegExp} first
       * @param {RegExp} second
       */
      const then = (first, second) =>
        new RegExp(`${first.source}[^.]*${second.source}`);

      expect(stateOf(paid)).toBe("paid");
      // Paid by the first, as kept with it: its amount, then when; its memo
      // for another amount after it: when, then that amount.
      await vi.waitFor(() =>
        expect(get(requestsStore)[0].paid).toMatchObject({
          hash: (1).toString(16).padStart(64, "0"),
          lux: "10000000",
        }),
      );
      expect(paidLine).toMatch(then(figure("0.01 DUSK"), clockOf(at + 1000)));
      expect(paidLine).toMatch(then(clockOf(at + 4000), figure("0.02 DUSK")));
      expect(paidLine).not.toMatch(/Factura 4[45]/);

      // Not paid: the same memo first, then the same amount with another
      // memo, the first three that came; a right-to-left override would turn
      // a line around.
      const open = await show({ lux: "50000000", memo: "Factura 70" }, [
        row(1, { memo: "Factura 7O", value: 50_000_000n }),
        row(2, { memo: "Fra \u202E34 aruc", value: 50_000_000n }),
        row(3, { memo: "Factura 72", value: 50_000_000n }),
        row(4, { memo: "Factura 73", value: 50_000_000n }),
        row(5, { memo: "Factura 74", value: 50_000_000n }),
        row(6, { memo: "Factura 70", value: 70_000_000n }),
      ]);
      const line = open.querySelector(".requests__line")?.textContent ?? "";

      // Not paid by any: its memo for another amount, and the first three of
      // its amount with another memo, a lookalike's too, each as it's written.
      expect(stateOf(open)).toBe("check");
      expect(line).toMatch(figure("0.07 DUSK"));
      expect(line).toContain('"Factura 7O"');
      expect(line).toContain('"Fra \\u202e34 aruc"');
      expect(line).toContain('"Factura 73"');
      expect(line).not.toContain("Factura 74");
      expect(open).not.toHaveTextContent("\u202E");
      expect(open.querySelector(".requests__hidden")).not.toBeNull();
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should still offer to send a payment back for a request whose memo leaves no room to say so, as a refund alone", async () => {
      const PAYER =
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
      // 508 bytes: within a memo's 512, but not with "Refund: " before it.
      const memo = "x".repeat(508);
      const at = Date.now() - 10_000;
      const row = (/** @type {Record<string, unknown>} */ fields) => ({
        category: "received",
        counterparty: PAYER,
        hash: "ab".repeat(32),
        memo,
        privacy: "public",
        status: "executed",
        time: at + 500,
        value: 10_000_000n,
        ...fields,
      });

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "long",
            lux: "10000000",
            memo,
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [row({}), row({ hash: "cd".repeat(32), time: at + 2500 })],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const back = new URL(
        String(
          screen
            .getByRole("link", { name: /^Send back the payment of/ })
            .getAttribute("href"),
        ),
        "https://wallet.test",
      );

      expect(back.searchParams.get("memo")).toBe("Refund");
      expect(back.searchParams.get("to")).toBe(PAYER);
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should say a payment was sent back, offering Send back no more, and open Send back with its amount hidden with the balances", async () => {
      const PAYER =
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
      const at = Date.now() - 10_000;
      const row = (/** @type {Record<string, unknown>} */ fields) => ({
        category: "received",
        counterparty: PAYER,
        direction: "in",
        hash: "ab".repeat(32),
        memo: "Factura 43",
        privacy: "public",
        status: "executed",
        time: at + 500,
        value: 12_000_000n,
        ...fields,
      });
      const paidTwice = [
        row({}),
        row({ hash: "cd".repeat(32), time: at + 2500 }),
      ];

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "twice",
            lux: "12000000",
            memo: "Factura 43",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({ hasMore: false, rows: paidTwice });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const payments = () =>
        screen.getByRole("list", { name: "Payments for this request" });

      // What each brought, on its own line, with when.
      const second = Array.from(
        payments().querySelectorAll(".requests__payment > span:first-child"),
      ).find((line) => line.textContent?.includes(paidAt(at + 2500)));

      expect(second).toHaveTextContent(figure("0.012 DUSK"));

      vi.mocked(goto).mockClear();
      await fireEvent.click(
        screen.getByRole("link", { name: /^Send back the payment of/ }),
      );

      expect(goto).toHaveBeenCalledWith(
        expect.stringMatching(/^\/some-base-path\/dashboard\/send\/\?/),
        { state: { amountHidden: true, sendBack: true } },
      );

      // Sent back, on its way: at a time this device's clock says, behind
      // the chain's, before the block the payment came in.
      history.state?.set({
        hasMore: false,
        rows: [
          {
            blockHeight: null,
            category: "sent",
            counterparty: PAYER,
            direction: "out",
            hash: "f0".repeat(32),
            memo: "Refund: Factura 43",
            privacy: "public",
            source: "sent",
            status: "pending",
            time: at + 2000,
            value: 12_000_000n,
          },
          ...paidTwice,
        ],
      });
      await vi.advanceTimersByTimeAsync(0);

      // What went back, on its way, and Send back no more.
      expect(
        payments().querySelector(".requests__sent-back"),
      ).toHaveTextContent(figure("0.012 DUSK"));
      expect(
        screen.queryByRole("link", { name: /^Send back the payment of/ }),
      ).toBeNull();
      history.state?.set({ hasMore: false, rows: [] });
    });

    /**
     * A payment from PAYER of 0.012 DUSK, or what `fields` says, and a
     * refund like it sent back to PAYER.
     */
    const PAYER =
      "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
    const paid = (/** @type {Record<string, unknown>} */ fields) => ({
      category: "received",
      counterparty: PAYER,
      direction: "in",
      privacy: "public",
      status: "executed",
      value: 12_000_000n,
      ...fields,
    });
    const sentBack = (/** @type {Record<string, unknown>} */ fields) => ({
      category: "sent",
      counterparty: PAYER,
      direction: "out",
      hash: "f0".repeat(32),
      privacy: "public",
      status: "executed",
      value: 12_000_000n,
      ...fields,
    });

    it("should still offer to send a payment back after a refund like it that was sent before it came in, for another", async () => {
      const at = Date.now() - 10_000;

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "twice",
            lux: "12000000",
            memo: "Factura 43",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [
          paid({
            blockHeight: 120,
            hash: "cd".repeat(32),
            memo: "Factura 43",
            time: at + 2500,
          }),
          paid({
            blockHeight: 100,
            hash: "ab".repeat(32),
            memo: "Factura 43",
            time: at + 500,
          }),
          // Sent back for a request asked before this one.
          sentBack({
            blockHeight: 50,
            memo: "Refund: Factura 43",
            source: "public",
            time: at - 60_000,
          }),
          // Sent from here a day ago, and never in a block.
          sentBack({
            blockHeight: null,
            hash: "f2".repeat(32),
            memo: "Refund: Factura 43",
            source: "sent",
            status: "unknown",
            time: at - 24 * 60 * 60 * 1000,
          }),
        ],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const payments = () =>
        screen.getByRole("list", { name: "Payments for this request" });

      expect(payments().querySelector(".requests__sent-back")).toBeNull();
      expect(
        screen.getByRole("link", { name: /^Send back the payment of/ }),
      ).toBeInTheDocument();

      // One in a block after the payment's is its own.
      history.state?.update(({ rows }) => ({
        hasMore: false,
        rows: [
          sentBack({
            blockHeight: 130,
            hash: "f1".repeat(32),
            memo: "Refund: Factura 43",
            source: "public",
            time: at + 4000,
          }),
          ...rows,
        ],
      }));
      await vi.advanceTimersByTimeAsync(0);

      // What went back, and when, once a block has it.
      const sent = payments().querySelector(".requests__sent-back");

      expect(sent).toHaveTextContent(figure("0.012 DUSK"));
      expect(sent).toHaveTextContent(paidAt(at + 4000));
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should say a refund was sent back for one payment only, though another request's would be sent back alike", async () => {
      const at = Date.now() - 10_000;
      // No room in either for "Refund: " before it: both go back as a
      // refund alone.
      const [first, second] = ["x".repeat(508), "y".repeat(508)];

      localStorage.setItem(
        REQUESTS,
        JSON.stringify(
          [
            { at, id: "first", memo: first },
            { at: at + 100, id: "second", memo: second },
          ].map((asked) => ({
            ...asked,
            lux: "12000000",
            network: "testnet",
            to: ACCOUNT,
          })),
        ),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [
          sentBack({ memo: "Refund", time: at + 5000 }),
          paid({ hash: "b2".repeat(32), memo: second, time: at + 2500 }),
          paid({ hash: "a2".repeat(32), memo: first, time: at + 1500 }),
          paid({ hash: "b1".repeat(32), memo: second, time: at + 1000 }),
          paid({ hash: "a1".repeat(32), memo: first, time: at + 500 }),
        ],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      expect(
        screen.getAllByRole("list", { name: "Payments for this request" }),
      ).toHaveLength(2);
      expect(document.querySelectorAll(".requests__sent-back")).toHaveLength(1);
      expect(
        screen.getAllByRole("link", { name: /^Send back the payment of/ }),
      ).toHaveLength(1);
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should say what came in, in no colour, for a request of any amount paid with its memo, of whatever amount, and Paid twice for its memo again", async () => {
      const at = Date.now() - 1000;
      const row = (/** @type {Record<string, unknown>} */ fields) => ({
        category: "received",
        hash: "ab".repeat(32),
        memo: "Anticipo Proyecto Luna",
        privacy: "public",
        status: "executed",
        time: at + 500,
        value: 20_000_000n,
        ...fields,
      });

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "deposit",
            lux: null,
            memo: "Anticipo Proyecto Luna",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      // One lux with its memo pays it: what came in says how little.
      history.state?.set({ hasMore: false, rows: [row({ value: 1n })] });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      // Not a plain Paid: how little came in, in the badge, in no colour.
      const badge = () =>
        /** @type {HTMLElement} */ (
          screen.getByRole("listitem").querySelector(".requests__state")
        );

      /** What its card says of what came in. */
      const line = () =>
        screen.getByRole("listitem").querySelector(".requests__line");

      expect(badge()).toHaveTextContent(/^0\.000000001 DUSK$/);
      expect(badge()).not.toHaveClass("requests__state--paid");
      expect(line()).toHaveTextContent(figure("0.000000001 DUSK"));
      expect(line()).toHaveTextContent(clockOf(at + 500));
      await vi.waitFor(() => expect(get(requestsStore)[0].paid?.lux).toBe("1"));

      // Still, opened again once the payment is further back than what's
      // read, and hidden with the balances.
      cleanup();
      history.state?.set({ hasMore: false, rows: [] });
      hydrateRequests();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      expect(line()).toHaveTextContent(figure("0.000000001 DUSK"));

      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      await vi.advanceTimersByTimeAsync(0);

      expect(badge()).not.toHaveTextContent("0.000000001");
      expect(screen.getByRole("listitem")).not.toHaveTextContent("0.000000001");
      settingsStore.reset();

      history.state?.set({
        hasMore: false,
        rows: [row({}), row({ hash: "cd".repeat(32), time: at + 900 })],
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(stateOf(screen.getAllByRole("listitem")[0])).toBe("again");
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should say what's only a guess as one: the amount alone, with the memo that came, to check", async () => {
      const at = Date.now() - 1000;

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "open",
            lux: "150000000",
            memo: "Factura 105",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [
          {
            category: "received",
            hash: "cd".repeat(32),
            // An Arabic-Indic zero: it reads as 1.5.
            memo: "Factura 1\u06605",
            privacy: "public",
            status: "executed",
            time: at + 500,
            value: 150_000_000n,
          },
        ],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const item = screen.getByRole("listitem");

      expect(stateOf(item)).toBe("check");
      // As it's written, its Arabic-Indic zero set apart from what's around it.
      expect(item.textContent?.replace(/[\u2066-\u2069]/g, "")).toContain(
        '"Factura 1\u06605"',
      );
      expect(item.querySelector(".requests__hidden")).not.toBeNull();
      expect(get(requestsStore)[0].paid).toBeUndefined();
      history.state?.set({ hasMore: false, rows: [] });
    });

    // Q06, Amélie's: Lucas's new request said "Check it's this one" of a
    // payment she'd made two minutes before he asked. Sofía's: her unpaid
    // invoice 101 said "Check" for an hour, of invoice 102's payment.
    it("should count for a request no payment made before it was asked, nor one whose memo names another of the requests", async () => {
      const at = Date.now() - 60_000;
      /** @param {Record<string, unknown>} fields */
      const payment = (fields) => ({
        category: "received",
        privacy: "public",
        status: "executed",
        value: 10_000_000n,
        ...fields,
      });

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "tulips",
            lux: "10000000",
            memo: "Les tulipes de dimanche",
            network: "testnet",
            to: ACCOUNT,
          },
          {
            at: at - 3_600_000,
            id: "101",
            lux: "30000000",
            memo: "Factura F-2026-101",
            network: "testnet",
            to: ACCOUNT,
          },
          {
            at: at - 3_600_000,
            id: "102",
            lux: "30000000",
            memo: "Factura F-2026-102",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [
          // The same amount, two minutes before the request: not its.
          payment({
            hash: "a1".repeat(32),
            memo: "Wi-Fi coupé r35",
            time: at - 120_000,
          }),
          // Invoice 102's: never 101's.
          payment({
            hash: "b2".repeat(32),
            memo: "Factura F-2026-102",
            time: at - 1_800_000,
            value: 30_000_000n,
          }),
        ],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      /** @param {string} memo */
      const card = (memo) =>
        /** @type {HTMLElement} */ (
          screen
            .getAllByRole("listitem")
            .find((item) => item.textContent?.includes(memo))
        );

      for (const memo of ["Les tulipes de dimanche", "Factura F-2026-101"]) {
        expect(stateOf(card(memo))).toBe("waiting");
        expect(card(memo)).not.toHaveTextContent(/Wi-Fi|F-2026-102/);
      }

      expect(stateOf(card("Factura F-2026-102"))).toBe("paid");
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should hide what came in and what was asked with the balances, as History does", async () => {
      const at = Date.now() - 1000;

      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at,
            id: "by-memo",
            lux: "150000000",
            memo: "Factura 33",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [
          {
            category: "received",
            hash: "ef".repeat(32),
            memo: "Factura 33",
            privacy: "public",
            status: "executed",
            time: at + 500,
            value: 987_654_321n,
          },
        ],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const item = screen.getByRole("listitem");

      // Its memo came, for another amount: neither amount shows.
      expect(stateOf(item)).toBe("check");
      expect(item).not.toHaveTextContent(/0[.,]98/);
      expect(item).not.toHaveTextContent(/0[.,]15/);
      expect(
        screen
          .getByRole("button", { name: /^Remove the request/ })
          .getAttribute("aria-label"),
      ).not.toMatch(/0[.,]15/);

      settingsStore.reset();
      history.state?.set({ hasMore: false, rows: [] });
    });

    // Sofía's: right after an unlock, the list's Copy request gave "You're
    // asked to pay 0,01 DUSK …" without her name, at 1, 5 and 22 seconds,
    // while the same card's Share had it.
    it("should give the profile's name in a listed request's Copy request as in its Share, once it's looked up after the list shows", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      /** @type {PromiseWithResolvers<string>} */
      const named = Promise.withResolvers();

      Object.assign(navigator, { share });
      getPrimaryName.mockReturnValue(named.promise);
      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          {
            at: Date.now() - 1000,
            id: "open",
            lux: "10000000",
            memo: "Factura F-2026-125",
            network: "testnet",
            to: ACCOUNT,
          },
        ]),
      );
      hydrateRequests();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      // The name comes as the list shows.
      named.resolve("sofiadesign.dusk");
      await vi.advanceTimersByTimeAsync(0);

      const card = screen.getByRole("listitem");

      await fireEvent.click(
        within(card).getByRole("button", { name: /^Copy request for / }),
      );
      await fireEvent.click(
        within(card).getByRole("button", { name: /^Share the request for / }),
      );

      const copied = vi.mocked(navigator.clipboard.writeText).mock
        .lastCall?.[0];

      const [copiedLine] = String(copied).split("\n");

      expect(copiedLine).toMatch(/(?<![\w.-])sofiadesign\.dusk(?![\w.-])/);
      expect(copiedLine).toMatch(figure("0.01 DUSK"));
      expect(copiedLine).toContain("Factura F-2026-125");
      expect(share).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ text: copied }),
      );
    });

    it("should list the requests made, by this profile's addresses on this network, say what matched, and take one off", async () => {
      const at = Date.now() - 1000;
      /** @param {Record<string, unknown>} fields */
      const kept = (fields) => ({
        at,
        lux: "150000000",
        memo: "Factura 33",
        network: "testnet",
        to: ACCOUNT,
        ...fields,
      });

      localStorage.setItem(
        REQUESTS,
        JSON.stringify([
          kept({
            id: "paid",
            paid: { at: at + 500, hash: "ab".repeat(32) },
          }),
          kept({ id: "open", memo: "Factura 34" }),
          kept({ id: "elsewhere", network: "mainnet" }),
          kept({ id: "other", to: "someone-else" }),
        ]),
      );
      hydrateRequests();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const items = screen.getAllByRole("listitem");

      expect(items).toHaveLength(2);
      expect(stateOf(items[0])).toBe("paid");
      expect(items[0].querySelector(".requests__line")).toHaveTextContent(
        clockOf(at + 500),
      );
      expect(stateOf(items[1])).toBe("waiting");

      await fireEvent.click(
        screen.getByRole("button", {
          name: /^Remove the request for .*, Factura 34$/,
        }),
      );

      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
  });

  describe("Dusk Domains names", () => {
    /** @param {Element} container */
    const getShownName = (container) =>
      container.querySelector(".receive__name")?.textContent ?? "";

    it("should show the public account's name, looked up once the page has rendered", async () => {
      /** @type {Element | null} */
      let renderedAddress = null;

      getPrimaryName.mockImplementation(() => {
        renderedAddress = document.querySelector(".receive__full-address");

        return Promise.resolve("alice.dusk");
      });

      const { container } = render(Receive);

      await vi.runAllTimersAsync();

      expect(renderedAddress).toBeInstanceOf(HTMLElement);
      expect(getShownName(container)).toBe("alice.dusk");
      expect(shownAddress()).toBe(expectedAccount);
      expect(getPrimaryName).toHaveBeenCalledExactlyOnceWith(
        expectedAccount,
        "unknown",
        expect.any(String),
        undefined,
      );
    });

    it.each([
      ["pays to it", "alice.dusk"],
      ["doesn't pay to it", ""],
    ])(
      "should show the name with the shielded address only if the name %s",
      async (_, shieldedName) => {
        getPrimaryName.mockImplementation(
          (account, network, nodeUrl, shieldedAddress) =>
            Promise.resolve(shieldedAddress ? shieldedName : "alice.dusk"),
        );

        const { container, getByRole, queryByRole } = render(Receive);

        await vi.runAllTimersAsync();

        expect(getShownName(container)).toBe("alice.dusk");

        await fireEvent.click(getByRole("radio", { checked: false }));
        await vi.runAllTimersAsync();

        expect(shownAddress()).toBe(expectedAddress);
        expect(getShownName(container)).toBe(shieldedName);
        expect(queryByRole("button", { name: "Copy name" }) !== null).toBe(
          Boolean(shieldedName),
        );
        expect(getByRole("button", { name: "Copy address" })).toBeVisible();
        expect(getPrimaryName).toHaveBeenLastCalledWith(
          expectedAccount,
          "unknown",
          expect.any(String),
          expectedAddress,
        );
      },
    );

    it("should show no name, and only the address to copy, when the lookup fails", async () => {
      getPrimaryName.mockRejectedValue(new Error("Lookup failed"));

      const { container, queryByRole } = render(Receive);

      await vi.runAllTimersAsync();

      expect(container.querySelector(".receive__name")).toBeNull();
      expect(shownAddress()).toBe(expectedAccount);
      expect(queryByRole("button", { name: "Copy name" })).toBeNull();
    });

    it("should copy the name from its field, and the full address from its own", async () => {
      getPrimaryName.mockResolvedValue("alice.dusk");

      const { getByRole } = render(Receive);

      await vi.runAllTimersAsync();
      await fireEvent.click(getByRole("button", { name: "Copy name" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        "alice.dusk",
      );

      await fireEvent.click(getByRole("button", { name: "Copy address" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expectedAccount,
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    });
  });
});
