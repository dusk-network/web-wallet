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
import { get } from "svelte/store";

import * as navigation from "$lib/navigation";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { addWallet, unlockWallets } from "$lib/wallets";

import RemoveWallet from "../+page.svelte";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const page = vi.hoisted(() => ({ url: new URL("http://localhost/") }));

vi.mock("$app/stores", async () => {
  const { readable } = await import("svelte/store");

  return {
    page: {
      subscribe: (/** @type {(value: any) => void} */ run) =>
        readable({ url: page.url }).subscribe(run),
    },
  };
});

const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

describe("Remove wallet", () => {
  const gotoSpy = vi.spyOn(navigation, "goto").mockResolvedValue(undefined);

  stubWalletNetwork();

  /** @type {{ id: string, n: number }} */
  let first;

  beforeEach(async () => {
    localStorage.clear();
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
    [first] = vault.list() ?? [];
    await addWallet(B, PASSWORD);
    page.url = new URL(
      `http://localhost/settings/remove-wallet?wallet=${first.id}`
    );
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

  it("says what goes, waits for the phrase's box and the password, and takes only that wallet", async () => {
    const { getByLabelText, getByRole, getByText } = render(RemoveWallet);

    expect(
      getByText(
        "Wallet 1 leaves this device, with its contacts and activity. Its funds and stake stay on Dusk."
      )
    ).toBeInTheDocument();

    const password = getByLabelText("Password you unlock with");
    const remove = getByRole("button", { name: "Remove wallet" });

    expect(remove).toBeDisabled();

    await fireEvent.input(password, { target: { value: "password12" } });

    expect(remove).toBeDisabled();

    await fireEvent.click(
      getByLabelText(
        "I have Wallet 1's recovery phrase. It brings this wallet back."
      )
    );
    await fireEvent.input(password, { target: { value: "" } });

    expect(remove).toBeDisabled();

    await fireEvent.input(password, { target: { value: "password12" } });

    expect(remove).toBeEnabled();

    await fireEvent.click(remove);

    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent("Wrong password.")
    );
    expect(vault.list()).toHaveLength(2);

    await fireEvent.input(password, { target: { value: PASSWORD } });
    await fireEvent.click(getByRole("button", { name: "Remove wallet" }));

    await vi.waitFor(() => expect(gotoSpy).toHaveBeenCalledWith("/settings"));
    expect(vault.list()?.map(({ n }) => n)).toEqual([2]);
    expect(get(walletStore).wallets).toEqual([
      expect.objectContaining({ n: 2 }),
    ]);
  });

  it("goes back to Settings for a wallet that isn't here, or the only one", async () => {
    page.url = new URL("http://localhost/settings/remove-wallet?wallet=none");

    render(RemoveWallet);

    await vi.waitFor(() => expect(gotoSpy).toHaveBeenCalledWith("/settings"));
  });
});
