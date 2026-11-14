import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import * as navigation from "$lib/navigation";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, unlockWallets } from "$lib/wallets";

import CheckWords from "../+page.svelte";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

describe("Check your recovery words", () => {
  const gotoSpy = vi.spyOn(navigation, "goto").mockResolvedValue(undefined);

  stubWalletNetwork();

  beforeEach(async () => {
    localStorage.clear();
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    // The second wallet, open now: its words are the ones asked for.
    await addWallet(B, PASSWORD);
  });

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    await vault.clear();
    localStorage.clear();
    gotoSpy.mockClear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  /**
   * The words the check asks for, by their number, and their boxes.
   *
   * @param {HTMLElement} container
   */
  const askedIn = (container) =>
    Array.from(
      container.querySelectorAll(".recovery-check__word"),
      (label) => ({
        box: /** @type {HTMLInputElement} */ (label.querySelector("input")),
        n: Number(label.textContent?.replace(/\D/g, "")),
      })
    );

  it("asks for the password first, and says a wrong one is, asking for no word", async () => {
    const { container, getByLabelText, getByRole } = render(CheckWords);

    expect(askedIn(container)).toStrictEqual([]);

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: "not the password" },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));

    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent("Wrong password.")
    );
    expect(askedIn(container)).toStrictEqual([]);
  });

  it("checks three of the open wallet's words once the password opens it, keeping nothing of them", async () => {
    const kept = JSON.stringify({ ...localStorage });
    const { container, getByLabelText, getByRole, getByText } =
      render(CheckWords);

    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: PASSWORD },
    });
    await fireEvent.click(getByRole("button", { name: "Continue" }));
    await vi.waitFor(() => expect(askedIn(container)).toHaveLength(3));

    const words = B.split(" ");

    for (const { box, n } of askedIn(container)) {
      await fireEvent.input(box, { target: { value: words[n - 1] } });
    }

    await fireEvent.click(getByRole("button", { name: "Check" }));

    expect(getByText("They match.")).toBeInTheDocument();
    // Nothing of the phrase, nor what was typed, kept anywhere.
    expect(JSON.stringify({ ...localStorage })).toBe(kept);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("scheme");
  });
});
