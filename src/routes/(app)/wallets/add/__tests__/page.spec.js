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
import { unlockWallets } from "$lib/wallets";
import { readDirectory } from "$lib/wallets/directory";

import AddWallet from "../+page.svelte";

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

/**
 * Pastes text into a box, as a person does.
 *
 * @param {HTMLElement} box
 * @param {string} text
 */
const pasteInto = (box, text) =>
  fireEvent.paste(box, { clipboardData: { getData: () => text } });

describe("Add wallet", () => {
  const gotoSpy = vi.spyOn(navigation, "goto").mockResolvedValue(undefined);

  stubWalletNetwork();

  beforeEach(async () => {
    localStorage.clear();
    await vault.setUp(A, PASSWORD);
    await unlockWallets(PASSWORD);
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

  it("offers to create or import one, under the password every wallet shares", () => {
    const { getByRole, getByText } = render(AddWallet);

    expect(getByRole("heading", { level: 1 })).toHaveTextContent("Add wallet");
    expect(
      getByText("Your password unlocks every wallet here.")
    ).toBeInTheDocument();
    expect(getByRole("button", { name: /Create wallet/ })).toBeInTheDocument();
    expect(getByRole("button", { name: /Import wallet/ })).toBeInTheDocument();
  });

  it("says which wallet the phrase becomes, and refuses one that's here already as it's entered", async () => {
    const { getByLabelText, getByRole, getByText } = render(AddWallet);

    await fireEvent.click(getByRole("button", { name: /Import wallet/ }));

    expect(getByText("This becomes Wallet 2.")).toBeInTheDocument();

    await pasteInto(getByLabelText("Word 5"), A);
    await fireEvent.click(getByRole("button", { name: "Next" }));

    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent(
        "This recovery phrase is already in your wallet."
      )
    );
    expect(getByRole("button", { name: "Next" })).toBeDisabled();
    expect(vault.list()).toHaveLength(1);
  });

  it("imports one with the password the wallets share: a wrong one said under it, then the new wallet opens", async () => {
    const { getByLabelText, getByRole, getByText } = render(AddWallet);

    await fireEvent.click(getByRole("button", { name: /Import wallet/ }));
    await pasteInto(getByLabelText("Word 1"), B);
    await fireEvent.click(getByRole("button", { name: "Next" }));

    // Where it syncs from, then the password.
    await vi.waitFor(() =>
      expect(getByText("Block Height")).toBeInTheDocument()
    );
    await fireEvent.click(getByRole("button", { name: "Next" }));

    const password = getByLabelText("Password you unlock with");

    expect(password).not.toHaveAttribute("placeholder");
    expect(password).toHaveAccessibleDescription(
      "One password unlocks every wallet here."
    );

    await fireEvent.input(password, { target: { value: "password12" } });
    await fireEvent.click(getByRole("button", { name: "Import wallet" }));

    await vi.waitFor(() =>
      expect(getByRole("alert")).toHaveTextContent("Wrong password.")
    );
    expect(vault.list()).toHaveLength(1);

    await fireEvent.input(password, { target: { value: PASSWORD } });
    await fireEvent.click(getByRole("button", { name: "Import wallet" }));

    await vi.waitFor(() => expect(gotoSpy).toHaveBeenCalledWith("/dashboard"));

    const [, added] = vault.list() ?? [];

    expect(added).toMatchObject({ n: 2 });
    expect(get(walletStore).walletKey).toBe(added.id);
  });

  it("creates one: its phrase written down and tapped back, then sealed, made at the block it's made at", async () => {
    const { container, getAllByRole, getByLabelText, getByRole } =
      render(AddWallet);

    await fireEvent.click(getByRole("button", { name: /Create wallet/ }));

    for (const box of getAllByRole("checkbox")) {
      await fireEvent.click(box);
    }

    await fireEvent.click(getByRole("button", { name: "Next" }));

    // The words as the page shows them to be written down.
    const words = Array.from(
      container.querySelectorAll(".dusk-words__word"),
      (word) => word.textContent?.trim() ?? ""
    );

    expect(words).toHaveLength(12);

    await fireEvent.click(getByRole("button", { name: "Next" }));

    for (const word of words) {
      const [button] = getAllByRole("button", { name: word }).filter(
        (b) => !(/** @type {HTMLButtonElement} */ (b).disabled)
      );

      await fireEvent.click(button);
    }

    await fireEvent.click(getByRole("button", { name: "Next" }));
    await fireEvent.input(getByLabelText("Password you unlock with"), {
      target: { value: PASSWORD },
    });
    await fireEvent.click(getByRole("button", { name: "Add wallet" }));

    await vi.waitFor(() => expect(gotoSpy).toHaveBeenCalledWith("/dashboard"));

    const [, added] = vault.list() ?? [];

    expect(added).toMatchObject({ n: 2 });
    expect(readDirectory().wallets[added.id]).toMatchObject({
      height: "123",
    });
    expect((await vault.unlock(PASSWORD)).wallets[1].mnemonic).toBe(
      words.join(" ")
    );
  });
});
