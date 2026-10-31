import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, switchToWallet, unlockWallets } from "$lib/wallets";
import { readDirectory } from "$lib/wallets/directory";

import AddWalletInLayout from "./AddWalletInLayout.svelte";

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
});
