import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { get } from "svelte/store";

import {
  clearActivityStore,
  commitActivityStep,
  getShieldedHistoryRecord,
  listActivityEntries,
  listLocalTransactions,
  putLocalTransaction,
  putShieldedHistoryRecord,
} from "$lib/activity/activityStore";
import { contactsWritten, listContacts, saveContact } from "$lib/contacts";
import { toastList } from "$lib/dusk/components/Toast/store";
import AddressSyncer from "$lib/mocks/AddressSyncer";
import { walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";
import { walletCacheFor } from "$lib/wallet-cache";
import { addWallet, unlockWallets } from "$lib/wallets";
import { suffixOf } from "$lib/wallets/dataNames";
import { readDirectory } from "$lib/wallets/directory";

import Settings from "../+page.svelte";

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

/** An address only these tests keep a balance under, in a wallet's cache. */
const MARKER = "kept-by-the-test";

/** The toasts shown, each as it came: they go at once in a test. */
const toasts = /** @type {string[]} */ ([]);
const seen = new Set();

toastList.subscribe((list) => {
  for (const { id, message } of list) {
    if (!seen.has(id)) {
      seen.add(id);
      toasts.push(message);
    }
  }
});

/**
 * Two wallets here, the second open, made here at block 42.
 */
async function twoWallets() {
  await vault.setUp(A, PASSWORD);
  await unlockWallets(PASSWORD);

  const [first] = vault.list() ?? [];
  const firstProfiles = get(walletStore).profiles;
  const second = await addWallet(B, PASSWORD, { height: 42n, syncFrom: 42n });

  await vi.waitUntil(() => !get(walletStore).syncStatus.isInProgress);

  return {
    first: { key: first.id, profile: firstProfiles[0] },
    second: { key: second.id, profile: get(walletStore).profiles[0] },
  };
}

/**
 * Keeps something of every kind a resync could touch for a wallet: in its
 * cache, and in its history.
 *
 * @param {{ key: string, profile: Profile }} wallet
 */
async function keepDataOf({ key, profile }) {
  const cache = walletCacheFor(suffixOf(key, readDirectory().legacy));
  const account = String(profile.account);

  await cache.setBalanceInfo(MARKER, {
    shielded: { spendable: 1n, value: 1n },
    unshielded: { nonce: 1n, value: 1n },
  });
  await commitActivityStep(
    `testnet::${account}`,
    [/** @type {any} */ ({ blockHeight: 1, hash: "h" })],
    () => /** @type {any} */ ({ from: 0, to: 1 })
  );
  await putLocalTransaction(`testnet::${account}`, { hash: "l" });
  await putShieldedHistoryRecord(
    `testnet::${profile.address}`,
    /** @type {any} */ ({ decoys: [5], entries: [], fingerprint: "f" })
  );
}

/**
 * What's kept of a wallet.
 *
 * @param {{ key: string, profile: Profile }} wallet
 */
async function dataOf({ key, profile }) {
  const cache = walletCacheFor(suffixOf(key, readDirectory().legacy));
  const account = String(profile.account);

  return {
    cache: (await cache.getBalanceInfo(MARKER)).unshielded.value === 1n,
    history: (await listActivityEntries(`testnet::${account}`)).length,
    sent: (await listLocalTransactions(`testnet::${account}`)).length,
    shielded: Boolean(
      await getShieldedHistoryRecord(`testnet::${profile.address}`)
    ),
  };
}

const ALL = { cache: true, history: 1, sent: 1, shielded: true };

/**
 * Settings, at the Resync under Advanced.
 */
async function openResync() {
  const settings = render(Settings);

  await fireEvent.click(settings.getByRole("button", { name: "Advanced" }));

  const group = settings.getByRole("group", { name: "Resync" });

  return { group, settings };
}

describe("Settings › Resync", () => {
  stubWalletNetwork();

  const findNotes = AddressSyncer.prototype.notes;
  const notesSpy = vi.spyOn(AddressSyncer.prototype, "notes");

  /** The block each sync asked the notes from. */
  const notesFrom = () =>
    notesSpy.mock.calls.map(([, options]) => options?.from);

  afterEach(async () => {
    cleanup();
    walletStore.reset();
    await vault.clear();
    await clearActivityStore();
    localStorage.clear();
    toasts.length = 0;
    notesSpy.mockClear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("clears only the open wallet's cache and history, after asking, then syncs it from its creation block", async () => {
    const { first, second } = await twoWallets();

    await keepDataOf(first);
    await keepDataOf(second);
    saveContact({ address: "somewhere", name: "A friend" });
    await contactsWritten();
    notesSpy.mockClear();

    const { group } = await openResync();

    expect(within(group).getByRole("combobox", { name: "From" })).toHaveValue(
      "creation"
    );
    expect(
      Array.from(
        within(group).getAllByRole("option"),
        (option) => option.textContent
      )
    ).toEqual(["Creation block, 42", "Genesis, block 0", "Another block"]);
    expect(group).toHaveTextContent(
      "Syncs this wallet again from the block you choose, after clearing its synced balances and history on this device. It can take a while. Contacts, settings and names stay."
    );

    // Asked first, in the page.
    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );

    expect(group).toHaveTextContent(
      "Resync Wallet 2 from block 42? Its balances and history clear, then fill in again as it syncs."
    );
    expect(notesSpy).not.toHaveBeenCalled();

    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await vi.waitFor(() => expect(toasts).toEqual(["Resynced from block 42."]));

    expect(notesFrom()).toEqual([42n]);
    // Its own transactions not in the archive yet stay, and so do the
    // heights its shielded history asks among.
    expect(await dataOf(second)).toEqual({ ...ALL, cache: false, history: 0 });
    expect(await dataOf(first)).toEqual(ALL);
    expect(listContacts().map(({ name }) => name)).toEqual(["A friend"]);
  });

  it("syncs from the first block, or one typed up to the network's latest", async () => {
    await twoWallets();
    notesSpy.mockClear();

    const { group } = await openResync();
    const from = within(group).getByRole("combobox", { name: "From" });

    await fireEvent.change(from, { target: { value: "typed" } });

    const height = within(group).getByRole("textbox", { name: "Block height" });

    await vi.waitFor(() =>
      expect(group).toHaveTextContent(
        "The maximum is 123, the network's latest block."
      )
    );

    await fireEvent.input(height, { target: { value: "124" } });
    await vi.waitFor(() =>
      expect(height).toHaveAttribute("aria-invalid", "true")
    );

    expect(
      within(group).getByRole("button", { name: "Resync" })
    ).toBeDisabled();

    await fireEvent.input(height, { target: { value: "123" } });
    await vi.waitFor(() =>
      expect(height).toHaveAttribute("aria-invalid", "false")
    );

    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await vi.waitFor(() =>
      expect(toasts).toEqual(["Resynced from block 123."])
    );

    await fireEvent.change(from, { target: { value: "genesis" } });
    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await vi.waitFor(() => expect(toasts).toHaveLength(2));

    expect(toasts.at(-1)).toBe("Resynced from block 0.");
    expect(notesFrom()).toEqual([123n, 0n]);
  });

  it("starts a block typed empty, and refuses one below 0 or past the network's latest before it clears anything", async () => {
    const { second } = await twoWallets();

    await keepDataOf(second);
    notesSpy.mockClear();

    const { group } = await openResync();

    await fireEvent.change(
      within(group).getByRole("combobox", { name: "From" }),
      {
        target: { value: "typed" },
      }
    );

    const height = within(group).getByRole("textbox", { name: "Block height" });
    const resync = within(group).getByRole("button", { name: "Resync" });

    // Nothing in it until one is typed.
    expect(height).toHaveValue("");
    expect(resync).toBeDisabled();

    await fireEvent.input(height, { target: { value: "-1" } });

    expect(height).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveTextContent("Enter a block height of 0 or more.");
    expect(resync).toBeDisabled();

    // Nor does the wallet, asked for them.
    await expect(walletStore.resync(-1n)).rejects.toThrow(RangeError);
    await expect(walletStore.resync(124n)).rejects.toThrow(RangeError);

    expect(await dataOf(second)).toEqual(ALL);
    expect(notesSpy).not.toHaveBeenCalled();
  });

  it("starts no resync while one runs", async () => {
    await twoWallets();
    notesSpy.mockClear();

    // The notes come only once released.
    const held = Promise.withResolvers();

    notesSpy.mockImplementationOnce(
      /** @this {AddressSyncer} */
      async function (...args) {
        await held.promise;

        return findNotes.apply(this, args);
      }
    );

    const { group } = await openResync();

    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await fireEvent.click(
      within(group).getByRole("button", { name: "Resync" })
    );
    await vi.waitFor(() =>
      expect(group).toHaveTextContent(
        "Resyncing from block 42. It can take a while."
      )
    );

    expect(within(group).queryByRole("button", { name: "Resync" })).toBeNull();
    expect(
      within(group).getByRole("combobox", { name: "From" })
    ).toBeDisabled();
    await expect(walletStore.resync(7n)).rejects.toThrow(
      "The wallet is syncing again already."
    );

    held.resolve(undefined);
    await vi.waitFor(() => expect(toasts).toEqual(["Resynced from block 42."]));

    expect(notesFrom()).toEqual([42n]);
    expect(
      within(group).getByRole("button", { name: "Resync" })
    ).not.toBeDisabled();
  });
});
