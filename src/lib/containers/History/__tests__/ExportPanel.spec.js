import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { networks } from "@dusk-network/networks";
import { tick } from "svelte";

import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import ExportPanel from "../ExportPanel.svelte";

/** The files made, as the test says they come out. */
const files = vi.hoisted(() => ({
  /** @type {import("vitest").Mock<(asked: any) => Promise<any>>} */
  make: vi.fn(),
}));

vi.mock("$lib/activity/accountantExport", async (importOriginal) => ({
  .../** @type {typeof import("$lib/activity/accountantExport")} */ (
    await importOriginal()
  ),
  makeExport: files.make,
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();

  return {
    ...original,
    walletStore: {
      ...original.walletStore,
      startHistory: () => ({}),
      whileOpen: () => (/** @type {unknown} */ value) => value,
    },
  };
});

const PROFILE_1 = "account-1";

// Nandini's: migrated to Profile 1 from both, as the chain says; the file
// books 0xB746's fees, and 0x90Fe's are in no row of it.
const B746 = "0xb7462f14bbdd4bbb68ad0ce1a7b6c1b4d6bfaa25";
const X90FE = "0x90fe2f14bbdd4bbb68ad0ce1a7b6c1b4d6bf2cbe";

/**
 * A file as `makeExport` makes it, with the network fees of migrations given.
 *
 * @param {Partial<{ approvalsUnread: any[], booked: string[], unread: any[] }>} evm
 */
const fileWith = (evm) => ({
  count: 3,
  csv: "",
  currency: "EUR",
  evm: { approvalsUnread: [], booked: [], unread: [], ...evm },
  fileName: "dusk-profile-1-mainnet-all.csv",
  hasOtherProfiles: false,
  left: { notRead: 0, outOfPeriod: 0, pending: 0 },
  shieldedWaiting: false,
  unpriced: 0,
});

describe("Export's network fees of migrations", () => {
  const props = {
    account: { address: PROFILE_1, label: "Profile 1" },
    network: "mainnet",
    shieldedAddress: "address-1",
  };

  /** What the panel says of them. */
  const said = () =>
    document
      .querySelector(".export-panel__evm .export-panel__note")
      ?.textContent?.trim();

  // Mainnet: migrations from BNB Smart Chain and Ethereum.
  beforeAll(() => setNodeNetwork(networks.mainnet));

  afterEach(() => {
    cleanup();
    files.make.mockReset();
  });

  afterAll(() => {
    setNodeNetwork(null);
    vi.doUnmock("$lib/activity/accountantExport");
    vi.doUnmock("$lib/stores");
  });

  it("names exactly the EVM addresses the file has the fees of, as made for the period chosen, saying so while it's made", async () => {
    const made = Promise.withResolvers();

    files.make.mockReturnValueOnce(made.promise);
    render(ExportPanel, props);

    expect(said()).toBe(
      "Reading which network fees of migrations the file has…"
    );
    expect(files.make).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.objectContaining({ period: "all" }),
      })
    );

    made.resolve(fileWith({ booked: [B746] }));

    await vi.waitFor(() =>
      expect(said()).toMatch(
        /^The file has the network fees paid from 0xb746…aa25\.$/i
      )
    );
    expect(said()).not.toMatch(/0x90fe/i);
  });

  it("says the file has none where it books none, for a period without migrations, and what it couldn't read", async () => {
    files.make.mockResolvedValueOnce(fileWith({ booked: [X90FE] }));

    const { getByRole } = render(ExportPanel, props);

    await vi.waitFor(() => expect(said()).toMatch(/0x90fe…2cbe/i));

    // A quarter with no migration in it: none.
    files.make.mockResolvedValueOnce(fileWith({}));
    await fireEvent.change(getByRole("combobox", { name: "Period" }), {
      target: {
        value: getByRole("combobox", { name: "Period" }).querySelectorAll(
          "option"
        )[1].value,
      },
    });

    await vi.waitFor(() =>
      expect(said()).toBe("The file has no network fees of migrations.")
    );

    // Back to all of it, whose migration's chain doesn't answer now.
    files.make.mockResolvedValueOnce(
      fileWith({
        booked: [X90FE],
        unread: [{ chain: "BNB Smart Chain", hash: `0x${"a7".repeat(32)}` }],
      })
    );
    await fireEvent.change(getByRole("combobox", { name: "Period" }), {
      target: { value: "all" },
    });

    await vi.waitFor(() =>
      expect(said()).toMatch(
        /^The file has the network fees paid from 0x90fe…2cbe\. 1 migration's fee on BNB Smart Chain couldn't be read\.$/i
      )
    );
  });

  it("says them as the file saved has them, though a reading begun before Save ends after it with what it read then", async () => {
    const before = Promise.withResolvers();
    const spies = [
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export"),
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {}),
      vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {}),
    ];

    try {
      files.make.mockReturnValueOnce(before.promise);

      const { getByRole } = render(ExportPanel, props);

      // Saved while the reading begun as it opened goes on: the file has the
      // migration's fees.
      files.make.mockResolvedValueOnce(fileWith({ booked: [B746] }));
      await fireEvent.click(getByRole("button", { name: "Save CSV" }));

      await vi.waitFor(() =>
        expect(said()).toMatch(
          /^The file has the network fees paid from 0xb746…aa25\.$/i
        )
      );
      expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();

      // The reading begun before ends now, with what it read then: none.
      before.resolve(fileWith({}));
      await before.promise;
      await tick();

      expect(said()).toMatch(
        /^The file has the network fees paid from 0xb746…aa25\.$/i
      );
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("says when what the file has couldn't be read", async () => {
    files.make.mockRejectedValueOnce(new Error("fetch failed"));
    render(ExportPanel, props);

    await vi.waitFor(() =>
      expect(said()).toBe(
        "Couldn't read which network fees of migrations the file has."
      )
    );
  });
});
