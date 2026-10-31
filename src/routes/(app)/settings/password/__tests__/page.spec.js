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

import ChangePassword from "../+page.svelte";

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

describe("Change password", () => {
  const gotoSpy = vi.spyOn(navigation, "goto").mockResolvedValue(undefined);

  stubWalletNetwork();

  beforeEach(async () => {
    localStorage.clear();
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
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

  it("seals every wallet again with the new password, once the fields are right and the current one is", async () => {
    const { getByLabelText, getByRole } = render(ChangePassword);
    const [current, next, again] = [
      "Current password",
      "New password",
      "Confirm password",
    ].map((label) => getByLabelText(label));
    const change = () =>
      fireEvent.click(getByRole("button", { name: "Change password" }));

    await change();
    expect(getByRole("alert")).toHaveTextContent("Enter your password.");

    await fireEvent.input(current, { target: { value: "password12" } });
    await fireEvent.input(next, { target: { value: "short" } });
    await change();
    expect(getByRole("alert")).toHaveTextContent("Use at least 8 characters.");

    await fireEvent.input(next, { target: { value: "a new password" } });
    await fireEvent.input(again, { target: { value: "another one" } });
    await change();
    expect(getByRole("alert")).toHaveTextContent("The passwords don't match.");

    await fireEvent.input(again, { target: { value: "a new password" } });
    await change();
    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent("Wrong password.")
    );

    await fireEvent.input(current, { target: { value: PASSWORD } });
    await change();
    await vi.waitFor(() => expect(gotoSpy).toHaveBeenCalledWith("/settings"));

    expect((await vault.unlock("a new password")).wallets).toHaveLength(2);
    await expect(vault.unlock(PASSWORD)).rejects.toThrow("Wrong password");
  });
});
