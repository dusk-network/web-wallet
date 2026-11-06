import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

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

      keepPlace({ pathname: "/some-base-path/dashboard/stake/", search: "" });

      const plain = render(Setup, {});

      expect(plain.queryByRole("region")).toBeNull();
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

  it("should offer a first-time visitor to create or restore a wallet, and nothing to unlock", () => {
    const { getByRole, queryByRole } = render(Setup, {});

    expect(getByRole("link", { name: "Create new wallet" })).toHaveClass(
      "dusk-anchor-button--variant--primary"
    );
    expect(getByRole("link", { name: "Restore wallet" })).toBeVisible();
    expect(queryByRole("link", { name: "Unlock" })).toBeNull();
  });

  it("should offer to unlock the wallet kept in this browser first, and a new one second", () => {
    settingsStore.update((settings) => ({ ...settings, userId: "some-id" }));

    const { getAllByRole, getByRole } = render(Setup, {});
    const unlock = getByRole("link", { name: "Unlock" });

    expect(unlock.getAttribute("href")).toMatch(/\/unlock$/);
    expect(getAllByRole("link")[0]).toBe(unlock);
    expect(unlock).toHaveClass("dusk-anchor-button--variant--primary");
    expect(getByRole("link", { name: "Create new wallet" })).toHaveClass(
      "dusk-anchor-button--variant--tertiary"
    );
  });
});
