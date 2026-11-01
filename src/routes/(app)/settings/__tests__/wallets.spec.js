import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import * as navigation from "$lib/navigation";
import { settingsStore, walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, switchToWallet, unlockWallets } from "$lib/wallets";

import Settings from "../+page.svelte";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const EVENT = `${CONFIG.LOCAL_STORAGE_APP_KEY}-wallet-event`;
const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

describe("Settings, with more than one wallet", () => {
  const logoutSpy = vi
    .spyOn(navigation, "logout")
    .mockImplementation(async () => walletStore.reset());

  stubWalletNetwork();

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    settingsStore.reset();
    await vault.clear();
    localStorage.clear();
    logoutSpy.mockClear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("says Lock, which locks every wallet in every tab, that auto-lock locks them all, and that Reset takes them all", async () => {
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    await addWallet(B, PASSWORD);

    const { getByRole, getByText } = render(Settings);

    expect(
      getByText("Locks every wallet after this long without use.")
    ).toBeInTheDocument();
    expect(
      getByRole("heading", { name: "Reset all wallets" })
    ).toBeInTheDocument();
    expect(
      getByText(
        "Removes every wallet from this browser, with its settings and contacts. Your funds stay on Dusk. You need each wallet's recovery phrase to get back in."
      )
    ).toBeInTheDocument();
    expect(
      getByRole("button", { name: "Reset all wallets" })
    ).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Lock" }));

    expect(logoutSpy).toHaveBeenCalledWith(false);
    expect(get(walletStore).wallets).toEqual([]);
    expect(JSON.parse(localStorage.getItem(EVENT) ?? "{}").type).toBe("lock");
  });

  it("shows the block the open wallet was made at, each its own", async () => {
    settingsStore.update((s) => ({ ...s, walletCreationBlockHeight: 99n }));
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);

    const [first] = vault.list() ?? [];

    await addWallet(B, PASSWORD, { height: 42n, syncFrom: 42n });

    const { getByRole, queryByDisplayValue } = render(Settings);

    await fireEvent.click(getByRole("button", { name: "Advanced" }));

    expect(queryByDisplayValue("42")).toBeInTheDocument();

    // The first wallet set up with a password isn't the one of before:
    // nothing kept of the block it was made at.
    await switchToWallet(first.id);
    cleanup();

    const again = render(Settings);

    await fireEvent.click(again.getByRole("button", { name: "Advanced" }));

    expect(again.queryByDisplayValue("42")).toBeNull();
    expect(again.queryByDisplayValue("99")).toBeNull();
  });
});
