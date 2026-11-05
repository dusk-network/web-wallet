import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { settingsStore } from "$lib/stores";

import { isRedirect } from "@sveltejs/kit";

import vault from "$lib/vault";

import Setup from "../+page.svelte";
import { load } from "../+page.js";

describe("Setup", () => {
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
