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

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import { walletStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { hydrateRequests, requestsStore } from "$lib/payment-requests";
import { parsePaymentLink } from "@dusk-network/app-core/payment-links";
import { networks } from "@dusk-network/networks";

import Receive from "../+page.svelte";

vi.useFakeTimers();

const { getPrimaryName } = vi.hoisted(() => ({ getPrimaryName: vi.fn() }));

vi.mock("$lib/dusk-domains", () => ({ getPrimaryName }));

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
        currentProfile: { account: ACCOUNT, address: expectedAddress },
      });
    });

    afterEach(() => {
      mockedWalletStore.setMockedStoreValue(before);
      setNodeNetwork(null);
      localStorage.removeItem(REQUESTS);
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
        screen.getByRole("button", { name: "Copy request link" })
      );
      await vi.runAllTimersAsync();

      const [[copied]] = vi.mocked(navigator.clipboard.writeText).mock.calls;

      expect(copied).toMatch(
        /^https:\/\/apps\.testnet\.dusk\.network\/wallet\/dashboard\/send\?/
      );
      expect(parsePaymentLink(copied)).toMatchObject({
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

    it("should say what's wrong with an amount, offer no link for it, and offer none with nothing asked", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();

      expect(screen.queryByRole("button", { name: "Copy request link" })).toBe(
        null
      );

      await type("Amount (optional)", "1.2345678901");
      await vi.runAllTimersAsync();

      expect(screen.getByRole("alert")).toHaveTextContent(/9 decimals/);
      expect(screen.queryByRole("button", { name: "Copy request link" })).toBe(
        null
      );
    });

    it("should ask for the shielded address on its tab", async () => {
      render(Receive);
      await vi.runAllTimersAsync();
      await openRequest();
      await type("Amount (optional)", "1");
      await fireEvent.click(screen.getByRole("radio", { checked: false }));
      await vi.runAllTimersAsync();
      await fireEvent.click(
        screen.getByRole("button", { name: "Copy request link" })
      );
      await vi.runAllTimersAsync();

      const copied = vi.mocked(navigator.clipboard.writeText).mock
        .lastCall?.[0];

      expect(parsePaymentLink(copied)).toMatchObject({ to: expectedAddress });
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
      await vi.runAllTimersAsync();
      await fireEvent.click(
        screen.getByRole("button", { name: "Download QR" })
      );
      await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(2));

      expect(anchorOf(1).download).toBe("dusk-public-request-qr.png");
      expect(get(requestsStore)).toMatchObject([{ lux: null }]);

      click.mockRestore();
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
      await vi.runAllTimersAsync();

      const items = screen.getAllByRole("listitem");

      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("Paid");
      expect(items[0]).toHaveTextContent("Amount and memo match a payment on");
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
