import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { get } from "svelte/store";
import { goto } from "$app/navigation";

import { claimDay } from "$lib/bridge/claimDate";
import { formatTime } from "@dusk-network/networks/format";
import { BALANCE_MASK } from "$lib/constants";
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
  refresh: vi.fn(() => Promise.resolve()),
  /** @type {import("svelte/store").Writable<any> | null} */
  state: null,
}));

vi.mock("$lib/activity", async (importOriginal) => {
  const { writable } = await import("svelte/store");

  history.state = writable({ hasMore: false, rows: [] });

  return {
    .../** @type {object} */ (await importOriginal()),
    activityState: history.state,
    currentActivity: () => ({ refresh: history.refresh }),
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
 * A time from `paidAt` as a sentence says it.
 *
 * @param {string} label
 */
const inSentence = (label) =>
  /^(Today|Yesterday),/.test(label)
    ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : `on ${label}`;

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
  });

  it("should copy the full address shown from its field, with no other copy button", async () => {
    const { getAllByRole, getByRole } = render(Receive);

    await vi.runAllTimersAsync();

    expect(
      getAllByRole("button").map((button) => button.getAttribute("aria-label"))
    ).toStrictEqual(["Copy address", null]);
    expect(getByRole("button", { name: "Download QR" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Back" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expectedAccount
    );

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();
    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expectedAddress
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
        new Event("toggle")
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
     * The link in what Copy or Share gave: a line saying what's asked, then
     * "Pay here: " and the link.
     *
     * @param {string | undefined} text
     */
    const linkIn = (text) => String(text).split("\nPay here: ")[1] ?? "";

    /** What the QR code on screen holds, as the library was asked to draw it. */
    const qrAlt = () => screen.getByRole("img", { name: /^QR code for your/ });

    it("should make a link the Send of any wallet reads, with the amount and memo asked, and keep it on the list as it's copied", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "0.15");
      await type("Memo (optional)", " Factura 33 ");
      await vi.runAllTimersAsync();

      expect(get(requestsStore)).toStrictEqual([]);
      await vi.waitFor(() =>
        expect(qrAlt()).toHaveAccessibleName("QR code for your payment request")
      );

      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" })
      );
      await vi.advanceTimersByTimeAsync(0);

      const [[copied]] = vi.mocked(navigator.clipboard.writeText).mock.calls;

      // What it asks in a line, as the extension gives it, then the link.
      expect(copied.split("\n")[0]).toBe(
        "You're asked to pay 0.15 DUSK on Testnet · Factura 33"
      );
      expect(linkIn(copied)).toMatch(
        /^https:\/\/apps\.testnet\.dusk\.network\/wallet\/dashboard\/send\?/
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

        expect(screen.queryByText(/^≈ /)).toBeNull();
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
          expect(
            screen.getByText(/^≈ €1\.00 · price at \d{1,2}:\d{2}/)
          ).toBeInTheDocument()
        );

        // The link asks what it asked: DUSK.
        await fireEvent.click(
          screen.getByRole("button", { name: "Copy request" })
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

      expect(screen.getByRole("alert")).toHaveTextContent(/9 decimals/);
      expect(screen.queryByRole("button", { name: "Copy request" })).toBe(null);
    });

    it("should ask which amount is meant of one that could be either of two, with a button for each, and make the request for the one picked", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "2.125");
      await vi.runAllTimersAsync();

      expect(screen.getByRole("alert")).toHaveTextContent(
        /^Is that 2\.1250 or 2125\?/
      );
      expect(screen.queryByRole("button", { name: "Copy request" })).toBe(null);

      await fireEvent.click(
        screen.getByRole("button", { name: "2.1250 DUSK" })
      );
      await vi.runAllTimersAsync();

      expect(
        screen.getByRole("textbox", { name: "Amount (optional)" })
      ).toHaveValue("2.1250");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Copy request" })
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

      expect(flag).toHaveTextContent(
        "It has hidden characters, shown here as codes."
      );

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
        screen.getByRole("button", { name: "Copy request" })
      );
      await vi.advanceTimersByTimeAsync(0);

      const copied = vi.mocked(navigator.clipboard.writeText).mock
        .lastCall?.[0];

      expect(parsePaymentLink(linkIn(copied))).toMatchObject({
        to: expectedAddress,
      });
    });

    // Chen's: the only Share sat up by the address, away from the request it
    // shared, which he had to guess. Then Sofía's and Nandini's: with a
    // request filled in, the first Copy and the first of two buttons called
    // Share gave a client the bare address.
    it("should name each button by what it gives, and while a request is made put its Copy and Share first, leading, the address's below, no two buttons of the page sharing a name", async () => {
      const first = render(Receive);

      await vi.runAllTimersAsync();

      // No share sheet: no Share.
      expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
      first.unmount();

      const share = vi.fn().mockResolvedValue(undefined);

      Object.assign(navigator, { share });
      render(Receive);
      await vi.runAllTimersAsync();

      /** The page's buttons by name, in the order they come. */
      const buttonNames = () =>
        screen
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

      expect(buttonNames()).toStrictEqual([
        "Copy address",
        "Share address",
        "Download QR",
      ]);

      await fireEvent.click(
        screen.getByRole("button", { name: "Share address" })
      );
      await vi.runAllTimersAsync();

      expect(share).toHaveBeenLastCalledWith({
        text: ACCOUNT,
        title: "My Dusk address",
      });
      expect(get(requestsStore)).toStrictEqual([]);

      // Request payment open: the address's buttons go below it.
      await openRequest();
      await vi.advanceTimersByTimeAsync(0);

      const form = /** @type {HTMLElement} */ (
        document.querySelector(".request")
      );
      /** @param {string} name */
      const isAfterForm = (name) =>
        Boolean(
          form.compareDocumentPosition(screen.getByRole("button", { name })) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ) && !form.contains(screen.getByRole("button", { name }));

      expect(isAfterForm("Copy address")).toBe(true);
      expect(isAfterForm("Share address")).toBe(true);
      expect(isAfterForm("Download QR")).toBe(true);

      // A request made: its own Copy and Share come first, and lead.
      await type("Amount (optional)", "2");
      await vi.advanceTimersByTimeAsync(0);

      expect(buttonNames()).toStrictEqual([
        "Copy request",
        "Share request",
        "Copy address",
        "Share address",
        "Download QR",
      ]);
      expect(screen.getByRole("button", { name: "Copy request" })).toHaveClass(
        "dusk-button--variant--primary"
      );
      expect(screen.getByRole("button", { name: "Share request" })).toHaveClass(
        "dusk-button--variant--primary"
      );
      expect(screen.getByRole("button", { name: "Copy address" })).toHaveClass(
        "dusk-button--variant--secondary"
      );

      // By the address, still the address alone.
      await fireEvent.click(
        screen.getByRole("button", { name: "Share address" })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(share).toHaveBeenLastCalledWith({
        text: ACCOUNT,
        title: "My Dusk address",
      });
      expect(get(requestsStore)).toStrictEqual([]);

      await fireEvent.click(
        screen.getByRole("button", { name: "Share request" })
      );
      await vi.advanceTimersByTimeAsync(0);

      // The request in a line, then its link, as text alone.
      expect(share.mock.lastCall?.[0]).toStrictEqual({
        text: expect.stringMatching(
          /^You're asked to pay 2 DUSK on Testnet\nPay here: https:/
        ),
        title: "Dusk payment request",
      });
      expect(
        parsePaymentLink(linkIn(share.mock.lastCall?.[0].text))
      ).toMatchObject({
        amountDusk: "2",
        to: ACCOUNT,
      });
      expect(get(requestsStore)).toMatchObject([{ lux: "2000000000" }]);

      // The sheet closed unused keeps nothing new.
      share.mockRejectedValueOnce(
        Object.assign(new Error("closed"), { name: "AbortError" })
      );
      await type("Amount (optional)", "3");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Share request" })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(get(requestsStore)).toHaveLength(1);

      // In the list, each its own, beside its Copy link.
      await fireEvent.click(
        screen.getByRole("button", { name: "Share the request for 2 DUSK" })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(share.mock.lastCall?.[0]).toStrictEqual({
        text: expect.stringMatching(
          /^You're asked to pay 2 DUSK on Testnet\nPay here: https:/
        ),
        title: "Dusk payment request",
      });
      expect(
        Array.from(
          document.querySelectorAll(".requests__actions button"),
          (b) => b.textContent?.trim()
        )
      ).toStrictEqual(["Copy link", "Share", "Remove"]);

      // No two buttons of the page share a name.
      const names = buttonNames();

      expect(new Set(names).size).toBe(names.length);

      // Closed again: the address's buttons back above it.
      await fireEvent.click(screen.getByText("Request payment"));
      /** @type {HTMLDetailsElement} */ (form).open = false;
      await fireEvent(form, new Event("toggle"));
      await vi.advanceTimersByTimeAsync(0);

      expect(isAfterForm("Copy address")).toBe(false);
    });

    // A request typed, then Receive left by a link and opened again, or
    // locked and unlocked: it comes back open, the QR and Download QR
    // holding it, the address's buttons below it.
    it("should bring back a request typed before, open, its QR and Download QR holding it", async () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const first = render(Receive);

      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "2");
      await type("Memo (optional)", "Factura 34");
      await vi.advanceTimersByTimeAsync(0);
      first.unmount();

      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const form = /** @type {HTMLDetailsElement} */ (
        document.querySelector(".request")
      );

      expect(form.open).toBe(true);
      expect(
        screen.getByRole("textbox", { name: "Amount (optional)" })
      ).toHaveValue("2");
      await vi.waitFor(() =>
        expect(qrAlt()).toHaveAccessibleName("QR code for your payment request")
      );
      expect(
        form.compareDocumentPosition(
          screen.getByRole("button", { name: "Download QR" })
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(
        /** @type {HTMLAnchorElement} */ (click.mock.contexts[0]).download
      ).toBe("dusk-testnet-request-2-DUSK-Factura-34.png");

      click.mockRestore();
    });

    // Sofía's, in the app: Request payment opened with its Amount at the
    // screen's bottom edge.
    it("should bring Request payment into view at its Amount, to type in, as a tap opens it", async () => {
      const scrolled = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});

      try {
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);
        await openRequest();
        // At the next frame, once what opened shows.
        await vi.advanceTimersByTimeAsync(50);

        const amount = screen.getByRole("textbox", {
          name: "Amount (optional)",
        });

        expect(document.activeElement).toBe(amount);
        expect(scrolled.mock.contexts).toStrictEqual([amount]);
      } finally {
        scrolled.mockRestore();
      }
    });

    it("should bring Request payment into view only once it has opened, as the page can't scroll to it before", async () => {
      /** @type {() => void} */
      let opened = () => {};
      const opening = {
        finished: new Promise((done) => {
          opened = () => done(undefined);
        }),
      };

      Object.defineProperty(HTMLDetailsElement.prototype, "getAnimations", {
        configurable: true,
        value: () => [opening],
      });

      const scrolled = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});

      try {
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);
        await openRequest();
        await vi.advanceTimersByTimeAsync(50);

        const amount = screen.getByRole("textbox", {
          name: "Amount (optional)",
        });

        expect(document.activeElement).toBe(amount);
        expect(scrolled).not.toHaveBeenCalled();

        opened();
        await vi.advanceTimersByTimeAsync(0);

        expect(scrolled.mock.contexts).toStrictEqual([amount]);
      } finally {
        Reflect.deleteProperty(HTMLDetailsElement.prototype, "getAnimations");
        scrolled.mockRestore();
      }
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
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(written.mock.calls.map(([text]) => text)).toStrictEqual([
        "Dusk payment request · Testnet",
        "0.05 DUSK",
        "Factura 33",
        `To ${shortenAddress(ACCOUNT)}`,
      ]);

      // Mainnet's is the one that names no network.
      setNodeNetwork(networks.mainnet);
      written.mockClear();
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(2));

      expect(written.mock.calls[0][0]).toBe("Dusk payment request");

      click.mockRestore();
      written.mockRestore();
    });

    it("should write and keep what was asked when Download QR was pressed, though it's changed before the picture is made", async () => {
      /** @type {(name: string) => void} */
      let named = () => {};

      getPrimaryName.mockReturnValue(
        new Promise((resolve) => {
          named = resolve;
        })
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
        screen.getByRole("button", { name: "Download QR" })
      );
      await type("Memo (optional)", "Factura 34");
      await vi.advanceTimersByTimeAsync(0);
      named("");
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(written.mock.calls.map(([text]) => text)).toContain("Factura 33");
      expect(written.mock.calls.map(([text]) => text)).not.toContain(
        "Factura 34"
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
        })
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
        screen.getByRole("button", { name: "Download QR" })
      );
      await fireEvent.click(screen.getByRole("radio", { checked: false }));
      await vi.advanceTimersByTimeAsync(0);
      named("");
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(written.mock.calls.map(([text]) => text)).toContain(
        `To ${shortenAddress(ACCOUNT)}`
      );
      expect(get(requestsStore)).toMatchObject([{ to: ACCOUNT }]);

      click.mockRestore();
      written.mockRestore();
    });

    it("should download the QR under a name that says what it holds, and keep a request with it", async () => {
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      render(Receive);
      await vi.runAllTimersAsync();
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      const anchorOf = (/** @type {number} */ call) =>
        /** @type {HTMLAnchorElement} */ (click.mock.contexts[call]);

      expect(anchorOf(0).download).toBe("dusk-public-receive-qr.png");
      expect(anchorOf(0).href).toMatch(/^data:image\/png/);
      expect(get(requestsStore)).toStrictEqual([]);

      await openRequest();
      await type("Memo (optional)", "Factura 33");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(2));

      expect(anchorOf(1).download).toBe("dusk-testnet-request-Factura-33.png");
      expect(get(requestsStore)).toMatchObject([{ lux: null }]);

      // Each its own: the amount too, and the memo's letters and digits.
      await type("Amount (optional)", "0,05");
      await type("Memo (optional)", " Factura 2026/052: \u202Eabril ");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(3));

      expect(anchorOf(2).download).toBe(
        "dusk-testnet-request-0.05-DUSK-Factura-2026-052-abril.png"
      );

      // In letters any browser keeps in a file's name: no accents.
      await type("Memo (optional)", "Factura 2026-071 Diseño web ß");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(4));

      expect(anchorOf(3).download).toBe(
        "dusk-testnet-request-0.05-DUSK-Factura-2026-071-Diseno-web.png"
      );

      click.mockRestore();
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
        ])
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

      // On the card, beside its Copy and Share: Paid, with when.
      expect(actionsOf(once)).toHaveTextContent(
        `Paid ${inSentence(paidAt(at + 500))} Copy link Share Remove`
      );
      expect(actionsOf(twice)).toHaveTextContent(
        `Paid twice, first ${inSentence(paidAt(at + 1500))} Copy link Share Remove`
      );

      // Copy link asks first, on the card, brought into view: nothing
      // copied yet.
      const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

      await fireEvent.click(
        screen.getByRole("button", {
          name: "Copy link of the request for 0.013 DUSK, Factura 2026-071",
        })
      );

      const asked = `This request was paid already, ${inSentence(paidAt(at + 500))}.`;

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(once.querySelector("[role=alert]")).toHaveTextContent(
        `${asked} Copy anyway Cancel`
      );
      expect(scrolled.mock.contexts).toContainEqual(
        once.querySelector(".paid-already")
      );
      scrolled.mockRestore();

      // Cancel: nothing given out, nothing asked any more.
      await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(once.querySelector("[role=alert]")).toBeNull();
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();

      // Copy anyway: the link, as before.
      await fireEvent.click(
        screen.getByRole("button", {
          name: "Copy link of the request for 0.013 DUSK, Factura 2026-071",
        })
      );
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy anyway" })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(
        parsePaymentLink(
          String(vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0])
        )
      ).toMatchObject({ amountDusk: "0.013", memo: "Factura 2026-071" });
      expect(once.querySelector("[role=alert]")).toBeNull();

      // Share on the one paid twice: asked first, with when it was first paid.
      await fireEvent.click(
        screen.getByRole("button", {
          name: "Share the request for 0.03 DUSK, Factura 2026-101",
        })
      );

      expect(share).not.toHaveBeenCalled();
      expect(twice.querySelector("[role=alert]")).toHaveTextContent(
        `This request was paid already, ${inSentence(paidAt(at + 1500))}. Share anyway Cancel`
      );

      await fireEvent.click(
        screen.getByRole("button", { name: "Share anyway" })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(share).toHaveBeenCalledOnce();
      expect(share.mock.lastCall?.[0].text).toMatch(
        /^You're asked to pay 0\.03 DUSK on Testnet · Factura 2026-101\nPay here: /
      );
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
        ])
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

      const asked = `This request was paid already, ${inSentence(paidAt(at + 500))}.`;
      const question = () => document.querySelector(".request [role=alert]");

      // Copy request: asked under it first.
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" })
      );

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(question()).toHaveTextContent(`${asked} Copy anyway Cancel`);

      await fireEvent.click(
        screen.getByRole("button", { name: "Copy anyway" })
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
        screen.getByRole("button", { name: "Share request" })
      );

      expect(question()).toHaveTextContent(`${asked} Share anyway Cancel`);

      await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(share).not.toHaveBeenCalled();
      expect(question()).toBeNull();

      // Download QR, as the QR holds it: asked under it first.
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(click).not.toHaveBeenCalled();
      expect(
        document.querySelector(".address-actions [role=alert]")
      ).toHaveTextContent(`${asked} Download anyway Cancel`);

      await fireEvent.click(
        screen.getByRole("button", { name: "Download anyway" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledOnce());

      expect(get(requestsStore).map(({ id }) => id)).toStrictEqual(["invoice"]);
      expect(screen.getAllByRole("listitem")).toHaveLength(1);

      // Another, not paid: nothing asked.
      await type("Memo (optional)", "Factura 2026-072");
      await vi.advanceTimersByTimeAsync(0);
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request" })
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
        ])
      );
      hydrateRequests();
      history.refresh.mockClear();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      expect(history.refresh).toHaveBeenCalledOnce();
      expect(screen.getByRole("listitem")).toHaveTextContent("Waiting");

      await vi.advanceTimersByTimeAsync(30_000);

      expect(history.refresh).toHaveBeenCalledTimes(2);

      history.state?.set({
        hasMore: false,
        rows: [payment("ab".repeat(32), at + 500)],
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(screen.getByRole("listitem")).toHaveTextContent("Paid");
      expect(screen.getByRole("listitem")).toHaveTextContent(
        `Amount and memo match a payment of 0.15 DUSK ${inSentence(paidAt(at + 500))}.`
      );
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
      expect(
        screen.getAllByRole("listitem")[0].querySelector(".requests__state")
      ).toHaveTextContent(/^Paid twice$/);

      // Not with the page gone.
      cleanup();
      history.refresh.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(history.refresh).not.toHaveBeenCalled();
      history.state?.set({ hasMore: false, rows: [] });
    });

    it("should say it's checking, not that nothing came in, while a payment to it from another profile here is looked for, two minutes at most", async () => {
      const at = Date.now() - 1000;
      const { awaitArrival, forgetArrivals } = await import("$lib/activity");

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
        ])
      );
      hydrateRequests();

      try {
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        expect(screen.getByRole("listitem")).toHaveTextContent(
          "Nothing matching has come in."
        );

        // Sent from another profile here, and seen to go out: the history
        // doesn't have it yet.
        awaitArrival({ hash: "ab".repeat(32), to: ACCOUNT });
        await vi.advanceTimersByTimeAsync(0);

        expect(screen.getByRole("listitem")).toHaveTextContent(
          "Checking for payments…"
        );
        expect(screen.getByRole("listitem")).not.toHaveTextContent(
          "Nothing matching"
        );

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

        expect(screen.getByRole("listitem")).toHaveTextContent("Paid");
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
          ])
        );
        hydrateRequests();
        awaitArrival({ hash: "cd".repeat(32), to: ACCOUNT });
        render(Receive);
        await vi.advanceTimersByTimeAsync(0);

        expect(screen.getByRole("listitem")).toHaveTextContent(
          "Checking for payments…"
        );

        await vi.advanceTimersByTimeAsync(120_000);

        expect(screen.getByRole("listitem")).toHaveTextContent(
          "Nothing matching has come in."
        );
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
        ])
      );
      hydrateRequests();
      history.state?.set({
        hasMore: false,
        rows: [row({}), row({ hash: "cd".repeat(32), time: at + 2500 })],
      });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const [item] = screen.getAllByRole("listitem");

      expect(item.querySelector(".requests__state")).toHaveTextContent(
        /^Paid twice$/
      );
      expect(item).toHaveTextContent("Amount and memo match 2 payments.");

      // Each payment to see; the second, to send back to whoever paid it.
      const payments = screen.getByRole("list", {
        name: "Payments for this request",
      });

      expect(
        Array.from(payments.querySelectorAll("a"), (link) => [
          link.textContent,
          link.getAttribute("href"),
        ])
      ).toStrictEqual([
        [
          "See in History",
          `/some-base-path/dashboard/transactions?tx=${"ab".repeat(32)}`,
        ],
        [
          "See in History",
          `/some-base-path/dashboard/transactions?tx=${"cd".repeat(32)}`,
        ],
        [
          "Send back",
          expect.stringMatching(/^\/some-base-path\/dashboard\/send\?/),
        ],
      ]);
      expect(payments).toHaveTextContent(paidAt(at + 2500));

      // Each to the second: two made in the same minute read apart.
      const times = Array.from(
        payments.querySelectorAll(".requests__payment > span:first-child"),
        (line) => line.textContent?.split(",").slice(0, 2).join(",")
      );

      expect(times).toStrictEqual([paidAt(at + 500), paidAt(at + 2500)]);
      expect(times[0]).not.toBe(times[1]);

      // Send back on the line of the payment it sends back.
      expect(
        screen
          .getByRole("link", { name: /^Send back the payment of/ })
          .closest(".requests__payment")
      ).toHaveTextContent(paidAt(at + 2500));

      const back = new URL(
        String(
          screen
            .getByRole("link", { name: /^Send back the payment of/ })
            .getAttribute("href")
        ),
        "https://wallet.test"
      );
      const asked = parsePaymentLink(
        `https://wallet.test/some-base-path${back.pathname.replace(/^\/some-base-path/, "")}${back.search}`,
        { walletUrl: "https://wallet.test/some-base-path" }
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
    it("should list on a card only what else could be its: the same memo first, the same amount with another memo only while it isn't paid, three at most, each memo quoted safely", async () => {
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
          ])
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

      expect(paid.querySelector(".requests__state")).toHaveTextContent(
        /^Paid$/
      );
      expect(paid).toHaveTextContent(
        `Amount and memo match a payment of 0.01 DUSK ${inSentence(paidAt(at + 1000))}. Also the same memo ${inSentence(paidAt(at + 4000))}, for 0.02 DUSK.`
      );
      expect(paid).not.toHaveTextContent("same amount");

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

      expect(open.querySelector(".requests__state")).toHaveTextContent(
        /^Check$/
      );
      expect(
        line.match(/Also the same (memo|amount)/g)?.map((also) => also.slice(9))
      ).toStrictEqual([
        "same memo",
        "same amount",
        "same amount",
        "same amount",
      ]);
      expect(line).toContain(
        `Also the same amount ${inSentence(paidAt(at + 2000))}, with another memo: "Fra \\u202e34 aruc".`
      );
      expect(line).toContain(`with another memo: "Factura 73".`);
      expect(line).not.toContain("Factura 74");
      expect(open).not.toHaveTextContent("\u202E");
      expect(open).toHaveTextContent(
        "A memo here has hidden characters, shown as codes."
      );
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
        ])
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
            .getAttribute("href")
        ),
        "https://wallet.test"
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
        ])
      );
      hydrateRequests();
      history.state?.set({ hasMore: false, rows: paidTwice });
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const payments = () =>
        screen.getByRole("list", { name: "Payments for this request" });

      // What each brought.
      expect(payments()).toHaveTextContent(`${paidAt(at + 2500)}, 0.012 DUSK`);

      vi.mocked(goto).mockClear();
      await fireEvent.click(
        screen.getByRole("link", { name: /^Send back the payment of/ })
      );

      expect(goto).toHaveBeenCalledWith(
        expect.stringMatching(/^\/some-base-path\/dashboard\/send\?/),
        { state: { amountHidden: true, sendBack: true } }
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

      // What went back, and where to see it: on its way, with no time a
      // block's would change.
      expect(payments()).toHaveTextContent(
        "Sent back 0.012 DUSK, on its way · See in History"
      );
      expect(
        screen.getByRole("link", {
          name: /^See in History: what was sent back for the payment of/,
        })
      ).toHaveAttribute(
        "href",
        `/some-base-path/dashboard/transactions?tx=${"f0".repeat(32)}`
      );
      expect(
        screen.queryByRole("link", { name: /^Send back the payment of/ })
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
        ])
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

      expect(payments()).not.toHaveTextContent("Sent back");
      expect(
        screen.getByRole("link", { name: /^Send back the payment of/ })
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

      // Its time first, as the payments' above it, once a block has it.
      expect(payments()).toHaveTextContent(
        `${paidAt(at + 4000)}, sent back 0.012 DUSK · See in History`
      );
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
          }))
        )
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
        screen.getAllByRole("list", { name: "Payments for this request" })
      ).toHaveLength(2);
      expect(
        screen
          .getAllByRole("list", { name: "Payments for this request" })
          .flatMap((list) => Array.from(list.children))
          .filter((payment) => /sent back/i.test(payment.textContent ?? ""))
      ).toHaveLength(1);
      expect(
        screen.getAllByRole("link", { name: /^Send back the payment of/ })
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
        ])
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

      expect(badge()).toHaveTextContent(/^0\.000000001 DUSK$/);
      expect(badge()).not.toHaveClass("requests__state--paid");
      expect(screen.getByRole("listitem")).toHaveTextContent(
        `Its memo matches a payment of 0.000000001 DUSK ${inSentence(paidAt(at + 500))}.`
      );
      await vi.waitFor(() => expect(get(requestsStore)[0].paid?.lux).toBe("1"));

      // Still, opened again once the payment is further back than what's
      // read, and hidden with the balances.
      cleanup();
      history.state?.set({ hasMore: false, rows: [] });
      hydrateRequests();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      expect(screen.getByRole("listitem")).toHaveTextContent(
        "Its memo matches a payment of 0.000000001 DUSK"
      );

      settingsStore.update((store) => ({ ...store, hideBalances: true }));
      await vi.advanceTimersByTimeAsync(0);

      expect(screen.getByRole("listitem")).toHaveTextContent(
        `Its memo matches a payment of ${BALANCE_MASK}`
      );
      expect(badge()).toHaveTextContent(BALANCE_MASK);
      expect(badge()).not.toHaveTextContent("0.000000001");
      expect(screen.getByRole("listitem")).not.toHaveTextContent("0.000000001");
      settingsStore.reset();

      history.state?.set({
        hasMore: false,
        rows: [row({}), row({ hash: "cd".repeat(32), time: at + 900 })],
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(
        screen.getAllByRole("listitem")[0].querySelector(".requests__state")
      ).toHaveTextContent(/^Paid twice$/);
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
        ])
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

      expect(item).toHaveTextContent("Check");
      expect(item).not.toHaveTextContent("Paid");
      // As it's written, its Arabic-Indic zero set apart from what's around it.
      expect(item.textContent?.replace(/[\u2066-\u2069]/g, "")).toContain(
        'with another memo: "Factura 1\u06605"'
      );
      expect(item).toHaveTextContent(
        "A number in a memo here may not be what it looks like."
      );
      expect(get(requestsStore)[0].paid).toBeUndefined();
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
        ])
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

      expect(item).toHaveTextContent("Same memo");
      expect(item).not.toHaveTextContent(/0[.,]98/);
      expect(item).not.toHaveTextContent(/0[.,]15/);
      expect(
        screen
          .getByRole("button", { name: /^Remove the request/ })
          .getAttribute("aria-label")
      ).not.toMatch(/0[.,]15/);

      settingsStore.reset();
      history.state?.set({ hasMore: false, rows: [] });
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
        ])
      );
      hydrateRequests();
      render(Receive);
      await vi.advanceTimersByTimeAsync(0);

      const items = screen.getAllByRole("listitem");

      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("Paid");
      expect(items[0]).toHaveTextContent(
        `Asked ${inSentence(claimDay(at, "en"))}. Amount and memo match a payment ${inSentence(paidAt(at + 500))}.`
      );
      expect(items[1]).toHaveTextContent("Waiting");
      expect(items[1]).toHaveTextContent("Nothing matching has come in.");
      expect(
        screen.getByRole("link", { name: "See in History" })
      ).toHaveAttribute(
        "href",
        expect.stringContaining(`/dashboard/transactions?tx=${"ab".repeat(32)}`)
      );

      await fireEvent.click(
        screen.getByRole("button", {
          name: /^Remove the request for .*, Factura 34$/,
        })
      );

      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
  });

  describe("Dusk Domains names", () => {
    /** @param {Element} container */
    const getShownName = (container) =>
      container.querySelector(".receive__name")?.textContent ?? "";

    /** @param {Element} container */
    const getNote = (container) => container.querySelector(".receive__note");

    it("should show the public account's name, looked up once the page has rendered, with what it reaches behind its info button", async () => {
      /** @type {Element | null} */
      let renderedAddress = null;

      getPrimaryName.mockImplementation(() => {
        renderedAddress = document.querySelector(".receive__full-address");

        return Promise.resolve("alice.dusk");
      });

      const { container, getByRole } = render(Receive);

      await vi.runAllTimersAsync();

      expect(renderedAddress).toBeInstanceOf(HTMLElement);
      expect(getShownName(container)).toBe("alice.dusk");
      expect(shownAddress()).toBe(expectedAccount);
      expect(getNote(container)).toBeNull();
      expect(getPrimaryName).toHaveBeenCalledExactlyOnceWith(
        expectedAccount,
        "unknown",
        expect.any(String),
        undefined
      );

      await fireEvent.click(getByRole("button", { name: "About this name" }));

      expect(getNote(container)).toBeVisible();
      expect(getNote(container)).toHaveTextContent(
        "People who send to alice.dusk reach this public account."
      );
    });

    it.each([
      [
        "pays to it",
        "alice.dusk",
        "People who pay alice.dusk choose public or shielded. Anyone can see this address belongs to alice.dusk.",
      ],
      ["doesn't pay to it", "", ""],
    ])(
      "should show the name with the shielded address only if the name %s",
      async (_, shieldedName, shieldedNote) => {
        getPrimaryName.mockImplementation(
          (account, network, nodeUrl, shieldedAddress) =>
            Promise.resolve(shieldedAddress ? shieldedName : "alice.dusk")
        );

        const { container, getByRole, queryByRole } = render(Receive);

        await vi.runAllTimersAsync();

        expect(getShownName(container)).toBe("alice.dusk");

        await fireEvent.click(getByRole("radio", { checked: false }));
        await vi.runAllTimersAsync();

        expect(shownAddress()).toBe(expectedAddress);
        expect(getShownName(container)).toBe(shieldedName);

        // What the name reaches, behind its info button.
        if (shieldedName) {
          await fireEvent.click(
            getByRole("button", { name: "About this name" })
          );
        }

        expect(getNote(container)?.textContent?.trim() ?? "").toBe(
          shieldedNote
        );
        expect(queryByRole("button", { name: "Copy name" }) !== null).toBe(
          Boolean(shieldedName)
        );
        expect(
          queryByRole("button", { name: "About this name" }) !== null
        ).toBe(Boolean(shieldedName));
        expect(getByRole("button", { name: "Copy address" })).toBeVisible();
        expect(getPrimaryName).toHaveBeenLastCalledWith(
          expectedAccount,
          "unknown",
          expect.any(String),
          expectedAddress
        );
      }
    );

    it("should show no name, and only the address to copy, when the lookup fails", async () => {
      getPrimaryName.mockRejectedValue(new Error("Lookup failed"));

      const { container, getAllByRole } = render(Receive);

      await vi.runAllTimersAsync();

      expect(container.querySelector(".receive__name")).toBeNull();
      expect(getNote(container)).toBeNull();
      expect(shownAddress()).toBe(expectedAccount);
      expect(
        getAllByRole("button").map((button) =>
          button.getAttribute("aria-label")
        )
      ).toStrictEqual(["Copy address", null]);
    });

    it("should copy the name from its field, and the full address from its own", async () => {
      getPrimaryName.mockResolvedValue("alice.dusk");

      const { getByRole } = render(Receive);

      await vi.runAllTimersAsync();
      await fireEvent.click(getByRole("button", { name: "Copy name" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        "alice.dusk"
      );

      await fireEvent.click(getByRole("button", { name: "Copy address" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expectedAccount
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    });
  });
});
