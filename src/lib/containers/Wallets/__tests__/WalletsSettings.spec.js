import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { addBasePath } from "$lib/navigation";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, unlockWallets } from "$lib/wallets";

import { WalletsSettings } from "..";

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

async function twoWallets() {
  await vault.setUp(A, PASSWORD);
  await unlockWallets(PASSWORD);

  const [first] = vault.list() ?? [];
  const second = await addWallet(B, PASSWORD);

  return { first, second };
}

describe("Settings › Wallets", () => {
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

  it("links a wallet's Remove to that wallet, while there's another", async () => {
    const { first } = await twoWallets();
    const { getByRole } = render(WalletsSettings);

    expect(getByRole("link", { name: "Remove Wallet 1" })).toHaveAttribute(
      "href",
      addBasePath(`/settings/remove-wallet?wallet=${first.id}`),
    );
  });
});
