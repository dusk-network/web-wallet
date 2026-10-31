import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { get } from "svelte/store";

import { addBasePath } from "$lib/navigation";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { getSeedFromMnemonic, profileGeneratorFrom } from "$lib/wallet";
import { addWallet, unlockWallets, walletDirectory } from "$lib/wallets";

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

  it("lists each wallet by its name, with Rename, Remove while there's another, Add wallet and Change password", async () => {
    const { first } = await twoWallets();
    const { getAllByRole, getByRole, getByText } = render(WalletsSettings);

    expect(
      getAllByRole("listitem").map(
        (item) => item.querySelector(".wallets-settings__title")?.textContent
      )
    ).toEqual(["Wallet 1", "Wallet 2"]);
    expect(
      getByRole("button", { name: "Rename Wallet 1" })
    ).toBeInTheDocument();
    expect(getByRole("link", { name: "Remove Wallet 1" })).toHaveAttribute(
      "href",
      addBasePath(`/settings/remove-wallet?wallet=${first.id}`)
    );
    expect(getByRole("link", { name: "Add wallet" })).toHaveAttribute(
      "href",
      addBasePath("/wallets/add")
    );
    expect(getByRole("link", { name: "Change password" })).toHaveAttribute(
      "href",
      addBasePath("/settings/password")
    );
    expect(
      getByText("Changes the password for every wallet here.")
    ).toBeInTheDocument();
  });

  it("renames a wallet in its own field, only on this device: Enter saves, Escape leaves it as it was", async () => {
    const { first } = await twoWallets();
    const { getByLabelText, getByRole, getByText, queryByLabelText } =
      render(WalletsSettings);

    await fireEvent.click(getByRole("button", { name: "Rename Wallet 1" }));

    const field = getByLabelText("Name");

    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("placeholder", "Wallet 1");
    expect(getByText("Only on this device.")).toBeInTheDocument();

    await fireEvent.input(field, { target: { value: "  Savings   jar " } });
    await fireEvent.keyDown(field, { key: "Escape" });

    expect(queryByLabelText("Name")).toBeNull();
    expect(get(walletDirectory).wallets[first.id]).not.toHaveProperty("name");

    await fireEvent.click(getByRole("button", { name: "Rename Wallet 1" }));
    await fireEvent.input(getByLabelText("Name"), {
      target: { value: "  Savings   jar " },
    });
    await fireEvent.keyDown(getByLabelText("Name"), { key: "Enter" });

    await vi.waitFor(() =>
      expect(get(walletDirectory).wallets[first.id].name).toBe("Savings jar")
    );
    await vi.waitFor(() =>
      expect(
        getByRole("button", { name: "Rename Savings jar" })
      ).toBeInTheDocument()
    );
  });

  it("offers no removal of the only wallet, and says a wallet without a password can't have another", async () => {
    await walletStore.init(await profileGeneratorFrom(getSeedFromMnemonic(A)));

    const { getAllByRole, getByText, queryByRole } = render(WalletsSettings);
    const [only] = getAllByRole("listitem");

    expect(within(only).queryByRole("link", { name: /Remove/ })).toBeNull();
    expect(queryByRole("link", { name: "Add wallet" })).toBeNull();
    expect(queryByRole("link", { name: "Change password" })).toBeNull();
    expect(
      getByText(
        "Adding a wallet needs a password. Restore this wallet with one first."
      )
    ).toBeInTheDocument();
  });
});
