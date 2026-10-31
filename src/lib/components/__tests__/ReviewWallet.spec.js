import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, renameWallet, unlockWallets } from "$lib/wallets";

import { ReviewWallet } from "..";

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

describe("ReviewWallet", () => {
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

  it("says nothing with one wallet, and which wallet and profile a review is from with more", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const one = render(ReviewWallet);

    expect(one.container).toHaveTextContent("");
    cleanup();

    const { id } = await addWallet(B, PASSWORD);
    const two = render(ReviewWallet);

    expect(two.container).toHaveTextContent("From Wallet 2 · Profile 1");

    await renameWallet(id, "Savings");

    await vi.waitFor(() =>
      expect(two.container).toHaveTextContent("From Savings · Profile 1")
    );
  });
});
