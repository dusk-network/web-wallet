import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { shortenAddress } from "$lib/dusk/string";
import { forgetPlace, keepPlace } from "$lib/navigation";
import { settingsStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { networks } from "@dusk-network/networks";

import { isRedirect } from "@sveltejs/kit";

import vault from "$lib/vault";

import Setup from "../+page.svelte";
import { load } from "../+page.js";

// The name the account a request pays goes by, as the chain says.
vi.mock("$lib/dusk-domains", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  getPrimaryName: vi.fn(async () => "sofia.dusk"),
}));

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

      expect(asked).toHaveTextContent("Amount 0.011 DUSK");
      expect(asked).toHaveTextContent("Memo Factura 044");
      expect(asked).toHaveTextContent("Create or restore a wallet to pay it.");
      expect(await findByText("sofia.dusk")).toBeInTheDocument();
      expect(asked).toHaveTextContent(shortenAddress(TO));
    });

    it("should say when it's for another network or says two amounts, and nothing for a page that asks for nothing", () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.011&network=mainnet`,
      });

      const other = render(Setup, {});

      expect(
        other.getByRole("region", { name: "Payment request" })
      ).toHaveTextContent("This request is for Mainnet. You are on Testnet.");
      cleanup();

      // Nor an amount for one saying two, in DUSK and in lux.
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: `?to=${TO}&amount=0.011&amountLux=150000000&network=testnet`,
      });

      const twice = render(Setup, {}).getByRole("region", {
        name: "Payment request",
      });

      expect(twice).toHaveTextContent(
        "This link asks for two different amounts. Ask for a new one."
      );
      expect(twice).not.toHaveTextContent("Amount");
      cleanup();

      // Nor one that says a field twice, which can't be read at all.
      for (const [search, words] of [
        [
          `?to=${TO}&amount=1&amount=2&network=testnet`,
          "This link asks for two different amounts. Ask for a new one.",
        ],
        [
          `?to=${TO}&memo=a&memo=b&network=testnet`,
          "This link says the memo twice. Ask for a new one.",
        ],
      ]) {
        keepPlace({ pathname: "/some-base-path/dashboard/send/", search });

        expect(
          render(Setup, {}).getByRole("region", { name: "Payment request" })
        ).toHaveTextContent(words);
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

      expect(asked).toHaveTextContent(
        "This link's address isn't valid. Ask for a new one."
      );
      expect(asked).not.toHaveTextContent("to pay it");
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
        `https://apps.dusk.network/wallet/dashboard/send?to=${TO}&amount=0.011&memo=Factura+044&network=mainnet`
      );
    });

    describe("on an Android phone", () => {
      const CHROME =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
      const FIREFOX =
        "Mozilla/5.0 (Android 14; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0";

      afterEach(() => {
        vi.restoreAllMocks();
      });

      /** @param {string} userAgent */
      const openOn = (userAgent) => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
        setNodeNetwork(networks.testnet);
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${TO}&amount=0.011&memo=Factura+044&network=testnet`,
        });

        return render(Setup, {});
      };

      it("should lead with the same request in Firefox and in the Dusk app, before a wallet is made here", () => {
        const { getAllByRole, getByRole } = openOn(CHROME);
        const links = getAllByRole("link").map(
          (link) => link.textContent?.trim() ?? ""
        );

        expect(getByRole("link", { name: "Open in Firefox" })).toHaveAttribute(
          "href",
          `intent://${location.host}/some-base-path/dashboard/send/?to=${TO}&amount=0.011&memo=Factura+044&network=testnet#Intent;scheme=${location.protocol.slice(0, -1)};package=org.mozilla.firefox;end`
        );
        expect(
          getByRole("link", { name: "Open in the Dusk app" })
        ).toHaveAttribute(
          "href",
          `dusk:public-${TO}@dusk:2?amount=0.011&memo=Factura+044`
        );
        expect(links.indexOf("Open in Firefox")).toBeLessThan(
          links.indexOf("Open in the Dusk app")
        );
        expect(links.indexOf("Open in the Dusk app")).toBeLessThan(
          links.indexOf("Create new wallet")
        );
        // Making one here comes after them.
        expect(getByRole("link", { name: "Create new wallet" })).toHaveClass(
          "dusk-anchor-button--variant--tertiary"
        );
      });

      it("should offer the Dusk app in Firefox, which has the page already", () => {
        const { getByRole, queryByRole } = openOn(FIREFOX);

        expect(queryByRole("link", { name: "Open in Firefox" })).toBeNull();
        expect(
          getByRole("link", { name: "Open in the Dusk app" })
        ).toBeInTheDocument();
      });

      it("should offer neither for a link that can't be paid as it is", () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(CHROME);
        setNodeNetwork(networks.testnet);
        keepPlace({
          pathname: "/some-base-path/dashboard/send/",
          search: `?to=${TO.slice(0, -6)}&amount=0.011&network=testnet`,
        });

        const { getByRole, queryByRole } = render(Setup, {});

        expect(queryByRole("link", { name: "Open in Firefox" })).toBeNull();
        expect(
          queryByRole("link", { name: "Open in the Dusk app" })
        ).toBeNull();
        expect(getByRole("link", { name: "Create new wallet" })).toHaveClass(
          "dusk-anchor-button--variant--primary"
        );
      });
    });
  });

  describe("opened by a request link, with the Dusk Wallet extension", () => {
    const TO =
      "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
    const SEARCH = `?to=${TO}&amount=0.011&memo=Factura+044&network=testnet`;

    /**
     * An extension that answers Dusk Connect's discovery: with its methods,
     * and what it says to a payment link.
     *
     * @param {string[]} methods
     * @param {unknown} answer
     */
    const extension = (methods, answer = true) => {
      const provider = {
        request: vi.fn(async ({ method }) => {
          if (method === "dusk_getCapabilities") {
            return { methods };
          }

          if (answer instanceof Error) {
            throw answer;
          }

          return answer;
        }),
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("dusk:announceProvider", { detail: { provider } })
        );

      window.addEventListener("dusk:requestProvider", announce);
      cleanups.push(() =>
        window.removeEventListener("dusk:requestProvider", announce)
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
      const { findByRole, findByText } = render(Setup, {});

      await fireEvent.click(
        await findByRole("button", { name: "Open in the Dusk extension" })
      );

      expect(provider.request).toHaveBeenLastCalledWith({
        method: "dusk_openPaymentLink",
        params: {
          link: expect.stringMatching(
            new RegExp(`/dashboard/send/?\\?to=${TO}&amount=0\\.011&`)
          ),
        },
      });
      expect(
        await findByText("Opened in the Dusk extension.")
      ).toBeInTheDocument();
    });

    it("leads with the extension where no wallet is kept here, with Create and Restore small under it, and with Unlock where one is", async () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: SEARCH,
      });
      extension(["dusk_getCapabilities", "dusk_openPaymentLink"]);

      const { findByRole, getByRole } = render(Setup, {});
      const open = await findByRole("button", {
        name: "Open in the Dusk extension",
      });

      expect(open).toHaveClass("dusk-button--variant--primary");
      expect(
        getByRole("region", { name: "Payment request" })
      ).toHaveTextContent("Pay it with the Dusk extension.");
      expect(
        getByRole("region", { name: "Payment request" })
      ).not.toHaveTextContent("Create or restore");

      for (const name of ["Create new wallet", "Restore wallet"]) {
        expect(getByRole("link", { name })).toHaveClass(
          "dusk-anchor-button--variant--tertiary",
          "dusk-anchor-button--size--small"
        );
      }

      cleanup();

      // A wallet kept here: unlocking it is the way in, the extension second.
      settingsStore.update((settings) => ({ ...settings, userId: "someone" }));

      try {
        const kept = render(Setup, {});

        expect(
          await kept.findByRole("button", {
            name: "Open in the Dusk extension",
          })
        ).toHaveClass("dusk-button--variant--secondary");
        expect(
          kept.getByRole("region", { name: "Payment request" })
        ).toHaveTextContent("Unlock to pay it.");
        expect(kept.getByRole("link", { name: "Unlock" })).toHaveClass(
          "dusk-anchor-button--variant--primary"
        );
      } finally {
        settingsStore.reset();
      }
    });

    it("says so where the extension has no wallet to pay with, and offers nothing where it won't take the link", async () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: SEARCH,
      });
      extension(["dusk_openPaymentLink"], false);

      const empty = render(Setup, {});

      await fireEvent.click(
        await empty.findByRole("button", { name: "Open in the Dusk extension" })
      );

      expect(
        await empty.findByText("The Dusk extension has no wallet to pay with.")
      ).toBeInTheDocument();
      // Making one here is the way, then.
      expect(
        empty.getByRole("region", { name: "Payment request" })
      ).toHaveTextContent("Create or restore a wallet to pay it.");
      expect(
        empty.getByRole("link", { name: "Create new wallet" })
      ).toHaveClass("dusk-anchor-button--variant--primary");
      cleanup();
      cleanups.splice(0).forEach((stop) => stop());

      extension(
        ["dusk_openPaymentLink"],
        Object.assign(new Error("Not a request link"), { code: -32602 })
      );

      const refused = render(Setup, {});

      await fireEvent.click(
        await refused.findByRole("button", {
          name: "Open in the Dusk extension",
        })
      );
      await vi.waitFor(() =>
        expect(
          refused.queryByRole("button", { name: "Open in the Dusk extension" })
        ).toBeNull()
      );
    });

    it("offers nothing with an extension too old to take it", async () => {
      setNodeNetwork(networks.testnet);
      keepPlace({
        pathname: "/some-base-path/dashboard/send/",
        search: SEARCH,
      });

      const provider = extension(["dusk_getCapabilities"]);
      const { queryByRole } = render(Setup, {});

      await vi.waitFor(() =>
        expect(provider.request).toHaveBeenCalledWith({
          method: "dusk_getCapabilities",
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        queryByRole("button", { name: "Open in the Dusk extension" })
      ).toBeNull();
    });
  });

  describe("with fingerprint or face unlock on", () => {
    const passkey = {
      credentialId: "a-credential",
      prf: new Uint8Array(32).fill(7),
      prfSalt: btoa("s".repeat(32)),
      transports: ["internal"],
    };
    const phrase =
      "scheme spot photo card baby mountain device kick cradle pact join borrow";
    /** @param {string} query */
    const loadAt = (query) =>
      load(
        /** @type {any} */ ({ url: new URL(`http://localhost/setup${query}`) })
      );

    afterEach(() => localStorage.clear());

    it("should go straight to the unlock, past the chooser, which the unlock's Back leads to", async () => {
      await vault.setUp(phrase, "the password");
      await vault.addPasskey(passkey, "the password");

      let redirected;

      try {
        loadAt("");
      } catch (error) {
        redirected = error;
      }

      expect(isRedirect(redirected)).toBe(true);
      expect(redirected).toMatchObject({
        location: expect.stringMatching(/\/unlock$/),
      });
      expect(() => loadAt("?choose")).not.toThrow();
    });

    it("should stay on the chooser without it", async () => {
      expect(() => loadAt("")).not.toThrow();

      await vault.setUp(phrase, "the password");

      expect(() => loadAt("")).not.toThrow();
    });
  });

  afterEach(() => {
    cleanup();
    settingsStore.reset();
  });

  it("should show the wallet's name, its ways in and its version, and no picture that could look broken", () => {
    const { container, getByRole } = render(Setup, {});

    expect(getByRole("heading", { level: 2 })).toHaveTextContent(
      "Dusk Web Wallet"
    );
    expect(container.querySelector("footer")).toHaveTextContent(
      "Web Wallet v0.1.5"
    );
    expect(container.querySelector("css-doodle, img, canvas")).toBeNull();
  });

  it("should link the version and the commit built to the build's manifest of every file, in a new tab", () => {
    const { getByRole } = render(Setup, {});

    // The commit is the version SvelteKit has: the test's is "any".
    const version = getByRole("link", { name: "Web Wallet v0.1.5 (any)" });

    expect(version).toHaveAttribute(
      "href",
      "/some-base-path/build-manifest.json"
    );
    expect(version).toHaveAttribute("target", "_blank");
  });

  it("should offer a first-time visitor to create or restore a wallet, and nothing to unlock", () => {
    const { getByRole, queryByRole } = render(Setup, {});
    const create = getByRole("link", { name: "Create new wallet" });

    expect(create).toHaveClass("dusk-anchor-button--variant--primary");
    expect(create).toHaveClass("dusk-anchor-button--size--default");
    expect(getByRole("link", { name: "Restore wallet" })).toBeVisible();
    expect(queryByRole("link", { name: "Unlock" })).toBeNull();
  });

  it("should offer to unlock the wallet kept in this browser as the way in, and a new one or a restore as small seconds", () => {
    settingsStore.update((settings) => ({ ...settings, userId: "some-id" }));

    const { getAllByRole, getByRole } = render(Setup, {});
    const unlock = getByRole("link", { name: "Unlock" });

    expect(unlock.getAttribute("href")).toMatch(/\/unlock$/);
    expect(getAllByRole("link")[0]).toBe(unlock);
    expect(unlock).toHaveClass("dusk-anchor-button--variant--primary");
    expect(unlock).toHaveClass("dusk-anchor-button--size--default");

    for (const name of ["Create new wallet", "Restore wallet"]) {
      const other = getByRole("link", { name });

      expect(other).toHaveClass("dusk-anchor-button--variant--tertiary");
      expect(other).toHaveClass("dusk-anchor-button--size--small");
    }
  });
});
