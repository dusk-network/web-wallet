import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, switchToWallet, unlockWallets } from "$lib/wallets";
import { readDirectory } from "$lib/wallets/directory";

import AddWalletInLayout from "./AddWalletInLayout.svelte";
import SendInLayout from "./SendInLayout.svelte";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const DIRECTORY = `${CONFIG.LOCAL_STORAGE_APP_KEY}-wallets`;
const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";
const C =
  "cat swing flag economy stadium alone churn speed unique patch report train";

/**
 * Pastes text into a box, as a person does.
 *
 * @param {HTMLElement} box
 * @param {string} text
 */
const pasteInto = (box, text) =>
  fireEvent.paste(box, { clipboardData: { getData: () => text } });

/** @param {HTMLElement} box */
const valueOf = (box) => /** @type {HTMLInputElement} */ (box).value;

describe("A wallet form in the app", () => {
  stubWalletNetwork();

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    await vault.clear();
    localStorage.clear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("keeps what's typed through a redraw that isn't about it, and drops it when another wallet opens", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const [first] = vault.list() ?? [];

    await addWallet(B, PASSWORD);

    const { getByLabelText, getByRole, queryByLabelText } =
      render(AddWalletInLayout);

    await fireEvent.click(getByRole("button", { name: /Import wallet/ }));
    await pasteInto(getByLabelText("Word 1"), C);

    // Another tab names the first wallet: the names show again, and the
    // words stay as they were.
    localStorage.setItem(
      DIRECTORY,
      JSON.stringify({
        ...readDirectory(),
        wallets: {
          ...readDirectory().wallets,
          [first.id]: { ...readDirectory().wallets[first.id], name: "Old" },
        },
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: DIRECTORY, storageArea: localStorage })
    );

    expect(valueOf(getByLabelText("Word 1"))).toBe(C.split(" ")[0]);

    // Another wallet opens: the page is drawn anew for it, with nothing
    // that was typed.
    await switchToWallet(first.id);

    await vi.waitFor(() => expect(queryByLabelText("Word 1")).toBeNull());
    expect(getByRole("button", { name: /Import wallet/ })).toBeInTheDocument();
  });

  it("stages nothing typed for one wallet on another: Send starts empty, and stays so going back", async () => {
    const RECIPIENT =
      "aTsZq814KfWUAQujzjBchbMEvqA1FiKBUakMCtAc2zCa74h9YVz4a2roYwS7LHDHeBwS1aap4f3GYhQBrxroYgsBcE5FJdkUbvpSD5LVXY6JRXNgMXgk6ckTPJUFKoHybff";

    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const [first] = vault.list() ?? [];
    const second = await addWallet(B, PASSWORD);
    const { getByRole } = render(SendInLayout, {
      availableBalance: 1_000_000_000_000n,
      execute: vi.fn(),
      gasLimits: {
        gasLimitLower: 10_000_000n,
        gasLimitUpper: 2_900_000_000n,
        gasPriceLower: 1n,
      },
      gasSettings: { gasLimit: 20_000_000n, gasPrice: 1n },
      publicAddress: "own-public-account",
      resolveName: vi.fn(),
      shieldedAddress: "own-shielded-address",
      shieldedBalance: 500_000_000_000n,
    });
    /** The form's fields, as they are now. */
    const typed = () =>
      ["To", "Amount", /^Memo/].map((name) =>
        valueOf(getByRole("textbox", { name }))
      );

    await fireEvent.input(getByRole("textbox", { name: "To" }), {
      target: { value: RECIPIENT },
    });
    await fireEvent.input(getByRole("textbox", { name: "Amount" }), {
      target: { value: "2.5" },
    });
    await fireEvent.input(getByRole("textbox", { name: /^Memo/ }), {
      target: { value: "Invoice 118" },
    });

    await vi.waitFor(() =>
      expect(typed()).toStrictEqual([RECIPIENT, "2.5", "Invoice 118"])
    );

    const form = getByRole("textbox", { name: "To" });

    await switchToWallet(first.id);

    await vi.waitFor(() => expect(form).not.toBeInTheDocument());
    expect(typed()).toStrictEqual(["", "", ""]);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("Invoice 118");

    await switchToWallet(second.id);

    await vi.waitFor(() => expect(typed()).toStrictEqual(["", "", ""]));
  });
});
