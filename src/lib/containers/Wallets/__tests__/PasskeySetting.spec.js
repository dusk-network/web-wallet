import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { canOfferPasskey } from "$lib/security/passkey";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import {
  fakeAuthenticator,
  removeFakeAuthenticator,
} from "$lib/test-helpers/fakeAuthenticator";
import vault from "$lib/vault";
import { unlockWallets } from "$lib/wallets";

import { PasskeySetting } from "..";

const PASSWORD = "the password";
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("Settings: unlock with fingerprint or face", () => {
  stubWalletNetwork();

  beforeEach(async () => {
    localStorage.clear();
    await vault.setUp(PHRASE, PASSWORD);
    await unlockWallets(PASSWORD);
  });

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    await vault.clear();
    removeFakeAuthenticator();
    localStorage.clear();
  });

  /** @param {import("@testing-library/svelte").RenderResult<any>} view */
  const theSwitch = (view) =>
    view.findByRole("switch", { name: "Unlock with fingerprint or face" });

  /**
   * Turns it on, as far as the password.
   *
   * @param {import("@testing-library/svelte").RenderResult<any>} view
   * @param {string} password
   */
  async function turnOnWith(view, password) {
    await fireEvent.click(await theSwitch(view));
    await fireEvent.input(view.getByLabelText("Password you unlock with"), {
      target: { value: password },
    });
    await fireEvent.click(view.getByRole("button", { name: "Turn on" }));
  }

  it("isn't offered where this browser or device can't, off by default where it can", async () => {
    fakeAuthenticator({ capabilities: { "extension:prf": false } });

    const off = render(PasskeySetting);

    await vi.waitFor(() =>
      expect(off.queryByRole("switch")).not.toBeInTheDocument()
    );
    off.unmount();
    removeFakeAuthenticator();

    fakeAuthenticator();

    const offered = render(PasskeySetting);

    expect(await theSwitch(offered)).not.toBeChecked();
    expect(vault.passkey()).toBeNull();
  });

  it("takes the password to turn on, and says what it means once it's on", async () => {
    const device = fakeAuthenticator();
    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);

    expect(
      await view.findByText(/On this device only\. Your password keeps working/)
    ).toBeInTheDocument();
    expect(device.create).toHaveBeenCalledOnce();
    expect(vault.passkey()).not.toBeNull();
    expect(await theSwitch(view)).toBeChecked();
  });

  it("says a wrong password is one, and asks the device nothing", async () => {
    const device = fakeAuthenticator();
    const view = render(PasskeySetting);

    await turnOnWith(view, "wrong");

    expect(await view.findByText("Wrong password.")).toBeInTheDocument();
    expect(device.create).not.toHaveBeenCalled();
    expect(vault.passkey()).toBeNull();
  });

  it("stays off when it's cancelled at the device, and says so", async () => {
    const device = fakeAuthenticator();

    device.personAnswers("NotAllowedError");

    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);

    expect(
      await view.findByText("Cancelled, so it stays off.")
    ).toBeInTheDocument();
    expect(vault.passkey()).toBeNull();
  });

  it("says a device with no PRF can't, stores nothing, and doesn't offer it again", async () => {
    fakeAuthenticator({ hasPrf: false });

    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);

    expect(
      await view.findByText(
        "This device or browser can't do fingerprint or face unlock, so it stays off."
      )
    ).toBeInTheDocument();
    expect(view.queryByRole("switch")).toBeNull();
    expect(vault.passkey()).toBeNull();
    view.unmount();

    const again = render(PasskeySetting);

    await expect(canOfferPasskey()).resolves.toBe(false);
    expect(again.queryByRole("switch")).toBeNull();
  });

  it("turns off at once, with no password, and the wallet still opens with it", async () => {
    fakeAuthenticator();

    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);
    await view.findByText(/On this device only/);
    await fireEvent.click(await theSwitch(view));

    await vi.waitFor(() => expect(vault.passkey()).toBeNull());
    expect(view.queryByLabelText("Password you unlock with")).toBeNull();
    await expect(vault.check(PASSWORD)).resolves.toBeUndefined();
  });

  it("offers nothing for a wallet without a password", async () => {
    fakeAuthenticator();
    await vault.clear();

    const view = render(PasskeySetting);

    await vi.waitFor(() => expect(view.queryByRole("switch")).toBeNull());
  });
});
