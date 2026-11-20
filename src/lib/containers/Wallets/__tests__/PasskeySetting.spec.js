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

  it("takes the password to turn on", async () => {
    const device = fakeAuthenticator();
    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);

    // On: the password asked for no more.
    await vi.waitFor(() =>
      expect(view.queryByLabelText("Password you unlock with")).toBeNull(),
    );
    expect(device.create).toHaveBeenCalledOnce();
    expect(vault.passkey()).not.toBeNull();
    expect(await theSwitch(view)).toBeChecked();
  });

  it("says a wrong password is one, and asks the device nothing", async () => {
    const device = fakeAuthenticator();
    const view = render(PasskeySetting);

    await turnOnWith(view, "wrong");

    await vi.waitFor(() =>
      expect(view.getByLabelText("Password you unlock with")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(device.create).not.toHaveBeenCalled();
    expect(vault.passkey()).toBeNull();
  });

  it("stays off when it's cancelled at the device, and says so", async () => {
    const device = fakeAuthenticator();

    device.personAnswers("NotAllowedError");

    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);

    expect(await view.findByRole("alert")).toBeInTheDocument();
    expect(vault.passkey()).toBeNull();
  });

  it("says a device with no PRF can't, stores nothing, and doesn't offer it again", async () => {
    fakeAuthenticator({ hasPrf: false });

    const view = render(PasskeySetting);

    await turnOnWith(view, PASSWORD);

    expect(await view.findByRole("status")).toBeInTheDocument();
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
    await vi.waitFor(() =>
      expect(view.queryByLabelText("Password you unlock with")).toBeNull(),
    );
    expect(vault.passkey()).not.toBeNull();
    await fireEvent.click(await theSwitch(view));

    await vi.waitFor(() => expect(vault.passkey()).toBeNull());
    expect(view.queryByLabelText("Password you unlock with")).toBeNull();
    await expect(vault.check(PASSWORD)).resolves.toBeUndefined();
  });
});
