import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import {
  sendPasswordLimit,
  setSendPasswordLimit,
} from "$lib/security/sendPassword";
import vault from "$lib/vault";

import { SendPasswordSetting } from "..";

const DUSK = 1_000_000_000n;
const PASSWORD = "the password here";
const PHRASE =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

describe("the password on big sends, in Settings", () => {
  beforeEach(async () => {
    await vault.setUp(PHRASE, PASSWORD);
  });

  afterEach(async () => {
    cleanup();
    setSendPasswordLimit(null);
    await vault.clear();
  });

  /** @param {import("@testing-library/svelte").RenderResult<any>} view */
  const toggle = ({ getByRole }) =>
    fireEvent.click(
      getByRole("switch", { name: "Ask for the password on big sends" })
    );

  /**
   * @param {import("@testing-library/svelte").RenderResult<any>} view
   * @param {string} password
   */
  const enterPassword = ({ getByLabelText }, password) =>
    fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: password },
    });

  /** @param {import("@testing-library/svelte").RenderResult<any>} view */
  const typeAmount = ({ getByLabelText }, /** @type {string} */ value) =>
    fireEvent.input(getByLabelText("Above this amount, in DUSK"), {
      target: { value },
    });

  it("is off until it's turned on", () => {
    const { getByRole, queryByLabelText } = render(SendPasswordSetting);

    expect(sendPasswordLimit()).toBeNull();
    expect(
      getByRole("switch", { name: "Ask for the password on big sends" })
    ).toHaveAttribute("aria-checked", "false");
    expect(queryByLabelText("Password you unlock with")).toBeNull();
  });

  it("turns on for the amount typed, once the password is checked against the vault", async () => {
    const view = render(SendPasswordSetting);

    await toggle(view);

    // Nothing counts until it's saved.
    expect(sendPasswordLimit()).toBeNull();

    await typeAmount(view, "1000,5");
    await enterPassword(view, "not the password");
    await fireEvent.click(view.getByRole("button", { name: "Save" }));

    expect(await view.findByText("Wrong password.")).toBeInTheDocument();
    expect(sendPasswordLimit()).toBeNull();

    await enterPassword(view, PASSWORD);
    await fireEvent.click(view.getByRole("button", { name: "Save" }));

    await vi.waitFor(() =>
      expect(sendPasswordLimit()).toBe(1_000_500_000_000n)
    );

    expect(
      await view.findByText(
        "Sends, stakes, shielding and the bridge above 1,000.5 DUSK, network fee included."
      )
    ).toBeInTheDocument();
    expect(view.queryByLabelText("Password you unlock with")).toBeNull();
    // The password goes with the form.
    expect(
      localStorage.getItem(`${CONFIG.LOCAL_STORAGE_APP_KEY}-send-password`)
    ).toBe("1000500000000");
    expect(JSON.stringify({ ...localStorage })).not.toContain(PASSWORD);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PASSWORD);
  });

  it("says what's wrong with an amount, and takes 0 for every send", async () => {
    const check = vi.spyOn(vault, "check");
    const view = render(SendPasswordSetting);

    await toggle(view);
    await enterPassword(view, PASSWORD);
    await typeAmount(view, "ten");
    await fireEvent.click(view.getByRole("button", { name: "Save" }));

    expect(view.getByRole("alert")).toHaveTextContent(
      "Enter an amount such as 100 or 100.5. 0 asks on every send."
    );
    expect(check).not.toHaveBeenCalled();

    check.mockRestore();

    await typeAmount(view, "0");
    await fireEvent.click(view.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(sendPasswordLimit()).toBe(0n));
  });

  it("takes the password to turn it off, or an unlocked tab could", async () => {
    setSendPasswordLimit(DUSK);

    const view = render(SendPasswordSetting);

    await toggle(view);

    // Off only once the password is given.
    expect(sendPasswordLimit()).toBe(DUSK);

    await fireEvent.click(view.getByRole("button", { name: "Turn off" }));

    expect(await view.findByText("Enter your password.")).toBeInTheDocument();
    expect(sendPasswordLimit()).toBe(DUSK);

    await enterPassword(view, "not the password");
    await fireEvent.click(view.getByRole("button", { name: "Turn off" }));

    expect(await view.findByText("Wrong password.")).toBeInTheDocument();
    expect(sendPasswordLimit()).toBe(DUSK);

    await enterPassword(view, PASSWORD);
    await fireEvent.click(view.getByRole("button", { name: "Turn off" }));

    await vi.waitFor(() => expect(sendPasswordLimit()).toBeNull());
  });

  it("takes the password to change the amount, and leaves it as it was on Cancel", async () => {
    setSendPasswordLimit(DUSK);

    const view = render(SendPasswordSetting);

    await fireEvent.click(view.getByRole("button", { name: "Change" }));

    expect(view.getByLabelText("Above this amount, in DUSK")).toHaveValue("1");

    await typeAmount(view, "5000");
    await fireEvent.click(view.getByRole("button", { name: "Cancel" }));

    expect(sendPasswordLimit()).toBe(DUSK);
    expect(view.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(view.container).toHaveTextContent("above 1 DUSK");
  });

  it("goes back to off on Cancel when it was being turned on", async () => {
    const view = render(SendPasswordSetting);

    await toggle(view);
    await fireEvent.click(view.getByRole("button", { name: "Cancel" }));

    expect(view.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(sendPasswordLimit()).toBeNull();
  });

  it("shows what another tab changed", async () => {
    const view = render(SendPasswordSetting);

    setSendPasswordLimit(2n * DUSK);
    window.dispatchEvent(
      new StorageEvent("storage", { storageArea: localStorage })
    );

    expect(await view.findByText(/above 2 DUSK/)).toBeInTheDocument();
    expect(view.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("isn't offered to a wallet without a password, and says why", async () => {
    await vault.clear();

    const { container, queryByRole } = render(SendPasswordSetting);

    expect(queryByRole("switch")).toBeNull();
    expect(container).toHaveTextContent(
      "Asking for the password on big sends needs a wallet with a password. This one opens with its recovery phrase, so there's none to ask for."
    );
  });
});
