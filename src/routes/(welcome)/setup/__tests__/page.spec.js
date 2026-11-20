import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { shortenAddress } from "$lib/dusk/string";
import { forgetPlace, keepPlace } from "$lib/navigation";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { networks } from "@dusk-network/networks";

import Setup from "../+page.svelte";

// The name the account a request pays goes by, as the chain says, and what
// a .dusk name is, as the name service says it: Sofía's, and no other.
vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getPrimaryName: vi.fn(async () => "sofia.dusk"),
  resolveDuskName: vi.fn(async (/** @type {string} */ name) =>
    name === "sofiadesign.dusk"
      ? {
          account:
            "sEeMSo7oiV2rxo6aZD3H75XGFZD95BtrmgFD3AezyUkC5W9bUyRwqFr6VuybvuvmvX5kTRt4STaSKbE6FEeMGoPDZNaX1LL82rGzN6BDbajY8qJcweu1mp7m1budNv9kgd7",
          name,
        }
      : { error: "not-registered", name },
  ),
}));

/**
 * A value as a regular expression matches it, its dots as dots.
 *
 * @param {string} value
 */
const literally = (value) => value.replaceAll(".", "\\.");

describe("Setup", () => {
  describe("opened by a link asking for a payment", () => {
    const TO =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";

    afterEach(() => {
      forgetPlace();
      setNodeNetwork(null);
    });

    it("should say what it asks, of whom and how much, before there's a wallet to pay it with", async () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.011&memo=Factura+044&network=testnet`,
      });

      const { findByText, getByRole } = render(Setup, {});
      const asked = getByRole("region", { name: "Payment request" });

      expect(asked).toHaveTextContent("0.011 DUSK");
      expect(asked).toHaveTextContent("Factura 044");
      expect(await findByText("sofia.dusk")).toBeInTheDocument();
      expect(asked).toHaveTextContent(shortenAddress(TO));
    });

    it("should show a .dusk name it pays whole, and where it points, or that it isn't registered, as one that looks like it does", async () => {
      setNodeNetwork(networks.testnet);

      /** @param {string} to */
      const askFor = (to) => {
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${to}&amount=0.01&memo=marek-r6-h51&network=testnet`,
        });

        return render(Setup, {});
      };

      // Registered: the account it points to, and nothing said against it.
      const registered = askFor("sofiadesign.dusk");
      const asked = registered.getByRole("region", { name: "Payment request" });

      await vi.waitFor(() => expect(asked).toHaveTextContent("sEeMSo…v9kgd7"));
      expect(registered.queryByRole("status")).toBeNull();
      expect(asked).toHaveTextContent("sofiadesign.dusk");
      expect(asked).not.toHaveTextContent("…n.dusk");
      cleanup();

      // One that looks like it, not registered: said, of the name whole.
      const lookalike = askFor("sofiadmarekn.dusk");

      expect(await lookalike.findByRole("status")).toHaveTextContent(
        "sofiadmarekn.dusk",
      );
      expect(
        lookalike.getByRole("region", { name: "Payment request" }),
      ).not.toHaveTextContent("…n.dusk");
    });

    it("should say when it's for another network or says two amounts, and nothing for a page that asks for nothing", () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.011&network=mainnet`,
      });

      // The network it's for, and the one this is.
      const other = render(Setup, {}).getByRole("region", {
        name: "Payment request",
      });

      expect(other).toHaveTextContent("Mainnet");
      expect(other).toHaveTextContent("Testnet");
      cleanup();

      // Nor an amount for one saying two, in DUSK and in lux.
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.011&amountLux=150000000&network=testnet`,
      });

      const twice = render(Setup, {}).getByRole("region", {
        name: "Payment request",
      });

      expect(twice).not.toHaveTextContent(/\d DUSK/);
      expect(twice).not.toHaveTextContent(TO.slice(0, 6));
      cleanup();

      // Nor one that says a field twice, which can't be read at all.
      for (const search of [
        `?to=${TO}&amount=1&amount=2&network=testnet`,
        `?to=${TO}&memo=a&memo=b&network=testnet`,
      ]) {
        keepPlace({ pathname: "/some-base-path/dashboard/send/", search });

        expect(
          render(Setup, {}).getByRole("region", { name: "Payment request" }),
        ).not.toHaveTextContent(TO.slice(0, 6));
        cleanup();
      }

      keepPlace({ pathname: "/some-base-path/dashboard/stake/", search: "" });

      const plain = render(Setup, {});

      expect(plain.queryByRole("region")).toBeNull();
    });

    it("should say before there's a wallet that a link's address was cut short on its way", () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO.slice(0, -6)}&amount=0.011&network=testnet`,
      });

      const asked = render(Setup, {}).getByRole("region", {
        name: "Payment request",
      });

      // Said, and nothing of what it asks.
      expect(asked).not.toHaveTextContent(TO.slice(0, 6));
      expect(asked).not.toHaveTextContent(/\d DUSK/);
    });

    it("should show nothing of what a refused link asks, only why, and an amount as the link writes it", () => {
      const OTHER =
        "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";

      setNodeNetwork(networks.testnet);

      for (const search of [
        // Two addresses, which read as one made of both.
        `?to=${TO},${OTHER}&amount=0.001&network=testnet`,
        // A hidden character in its amount.
        `?to=${TO}&amount=0.0%E2%80%8B1&network=testnet`,
        // A field's name with a hidden character, beside the field.
        `?to=${TO}&am%E2%80%8Fount=0.15&amount=0.001&network=testnet`,
        // A field's name in ASCII that only looks like one: a capital I.
        `?to=${TO}&amountIux=150000000&amount=0.001&network=testnet`,
        // A memo on two lines.
        `?to=${TO}&amount=0.001&memo=line%20one%0Aline%20two&network=testnet`,
      ]) {
        keepPlace({ pathname: "/some-base-path/dashboard/send/", search });

        const asked = render(Setup, {}).getByRole("region", {
          name: "Payment request",
        });

        expect(asked).not.toHaveTextContent(TO.slice(0, 6));
        expect(asked).not.toHaveTextContent(/\d DUSK/);
        expect(asked).not.toHaveTextContent("line one");
        cleanup();
      }

      // An amount with a decimal comma: as Send reads it.
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0,011&network=testnet`,
      });

      expect(
        render(Setup, {}).getByRole("region", { name: "Payment request" }),
      ).toHaveTextContent("0.011 DUSK");
    });

    it("should ask what Send asks of an amount that could be either of two, as 1.000, never settling it, and hand it on to another network's wallet as written", () => {
      setNodeNetwork(networks.testnet);

      // The amount as written, then the two it could be: no field here.
      for (const [amount, either, or] of [
        ["1.000", "1", "1000"],
        ["10.000", "10", "10000"],
        // As typed 2.125 is, in Send too.
        ["2.125", "2.1250", "2125"],
      ]) {
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${TO}&amount=${amount}&memo=invoice+17&network=testnet`,
        });

        const asked = render(Setup, {}).getByRole("region", {
          name: "Payment request",
        });

        expect(asked).toHaveTextContent(
          new RegExp(
            `${literally(amount)} DUSK\\D+${literally(either)}\\D+${or}\\b`,
          ),
        );
        expect(asked).not.toHaveTextContent(/\s10? DUSK/);
        cleanup();
      }

      // For Mainnet's wallet: its Send asks the same.
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=1.000&memo=invoice+17&network=mainnet`,
      });

      const { getByRole } = render(Setup, {});
      const switched = new URL(
        getByRole("link", { name: "Switch to Mainnet" }).getAttribute("href") ??
          "",
      );

      expect(switched.origin).toBe("https://apps.dusk.network");
      expect(switched.searchParams.get("amount")).toBe("1.000");
      expect(switched.searchParams.get("to")).toBe(TO);
    });

    it("should offer another network's request on that network's wallet", () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.011&memo=Factura+044&network=mainnet`,
      });

      const { getByRole } = render(Setup, {});

      expect(getByRole("link", { name: "Switch to Mainnet" })).toHaveAttribute(
        "href",
        `https://apps.dusk.network/wallet/dashboard/send?to=${TO}&amount=0.011&memo=Factura+044&network=mainnet`,
      );
    });

    describe("on an Android phone", () => {
      const CHROME =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("should offer the same request in the Dusk app and in Firefox", () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME);
        setNodeNetwork(networks.testnet);
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${TO}&amount=0.011&memo=Factura+044&network=testnet`,
        });

        const { getByRole } = render(Setup, {});

        expect(
          getByRole("link", { name: "Open in the Dusk app" }),
        ).toHaveAttribute(
          "href",
          `dusk:public-${TO}@dusk:2?amount=0.011&memo=Factura+044`,
        );
        expect(getByRole("link", { name: "Open in Firefox" })).toHaveAttribute(
          "href",
          `intent://${location.host}/some-base-path/dashboard/send/?to=${TO}&amount=0.011&memo=Factura+044&network=testnet#Intent;scheme=${location.protocol.slice(0, -1)};package=org.mozilla.firefox;end`,
        );
      });

      it("should offer the Dusk app no amount it would take as settled, as 1.000, which Firefox gets as written", () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME);
        setNodeNetwork(networks.testnet);
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${TO}&amount=1.000&network=testnet`,
        });

        const { getByRole, queryByRole } = render(Setup, {});

        expect(
          queryByRole("link", { name: "Open in the Dusk app" }),
        ).toBeNull();
        expect(getByRole("link", { name: "Open in Firefox" })).toHaveAttribute(
          "href",
          expect.stringContaining("amount=1.000"),
        );
      });

      it("should offer neither for a link that can't be paid as it is", () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME);
        setNodeNetwork(networks.testnet);
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${TO.slice(0, -6)}&amount=0.011&network=testnet`,
        });

        const { queryByRole } = render(Setup, {});

        expect(queryByRole("link", { name: "Open in Firefox" })).toBeNull();
        expect(
          queryByRole("link", { name: "Open in the Dusk app" }),
        ).toBeNull();
      });
    });
  });

  describe("opened by a request link, with the Dusk Wallet extension", () => {
    const TO =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
    const SEARCH = `?to=${TO}&amount=0.011&memo=Factura+044&network=testnet`;

    /**
     * An extension that answers Dusk Connect's discovery with its methods,
     * and takes a payment link.
     *
     * @param {string[]} methods
     */
    const extension = (methods) => {
      const provider = {
        request: vi.fn(async ({ method }) =>
          method === "dusk_getCapabilities" ? { methods } : true,
        ),
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("dusk:announceProvider", { detail: { provider } }),
        );

      window.addEventListener("dusk:requestProvider", announce);
      cleanups.push(() =>
        window.removeEventListener("dusk:requestProvider", announce),
      );

      return provider;
    };

    /** @type {Array<() => void>} */
    const cleanups = [];

    afterEach(() => {
      cleanups.splice(0).forEach((stop) => stop());
      forgetPlace();
      setNodeNetwork(null);
    });

    it("offers to open it in the extension that takes it, handing over the link it was opened with", async () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: SEARCH,
      });

      const provider = extension([
        "dusk_getCapabilities",
        "dusk_openPaymentLink",
      ]);
      const { findByRole } = render(Setup, {});

      await fireEvent.click(
        await findByRole("button", { name: "Open in the Dusk extension" }),
      );

      expect(provider.request).toHaveBeenLastCalledWith({
        method: "dusk_openPaymentLink",
        params: {
          link: expect.stringMatching(
            new RegExp(`/dashboard/send/?\\?to=${TO}&amount=0\\.011&`),
          ),
        },
      });
    });
  });

  afterEach(() => {
    cleanup();
  });
});
