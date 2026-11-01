import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { get } from "svelte/store";
import { Bookkeeper, Gas, Network } from "@dusk/w3sper";

import * as navigation from "$lib/navigation";
import { putLocalTransaction } from "$lib/activity/activityStore";
import { contactsNamespace } from "$lib/contacts/contactsVault";
import { InvalidPasswordError, WalletChangedError } from "$lib/errors";
import { networkStore, settingsStore, walletStore } from "$lib/stores";
import vault, { DUPLICATE_PHRASE, ONLY_WALLET } from "$lib/vault";
import fixtures from "$lib/vault/__tests__/fixtures/login-v1.json";
import { getSeedFromMnemonic, profileGeneratorFrom } from "$lib/wallet";
import WalletTreasury from "$lib/wallet-treasury";

import { walletDataSuffix } from "../dataNames";
import { noteActiveWallet, readDirectory, setLegacyWallet } from "../directory";
import { onOtherTabs, tellOtherTabs } from "../tabs";
import {
  addWallet,
  changeWalletPassword,
  followOtherTabs,
  lockWallets,
  removeWallet,
  renameWallet,
  switchToWallet,
  unlockWallets,
  walletDirectory,
  walletLabel,
} from "..";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

const APP = CONFIG.LOCAL_STORAGE_APP_KEY;
const V1 = `${APP}-login`;
const EVENT = `${APP}-wallet-event`;
const MIGRATIONS = `${APP}-migrations`;
const CONTACTS = `${APP}-encrypted-contacts`;
const CACHE = "@dusk-network/wallet-cache";
const PASSWORD = "password123";

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";
const C =
  "cat swing flag economy stadium alone churn speed unique patch report train";

/** @param {string} mnemonic */
const firstProfileOf = async (mnemonic) =>
  (await profileGeneratorFrom(getSeedFromMnemonic(mnemonic))).default;

const accounts = () =>
  get(walletStore).profiles.map((profile) => String(profile.account));

const lastEvent = () => JSON.parse(localStorage.getItem(EVENT) ?? "null");

/** The names of the databases kept here. */
const databases = async () =>
  (await indexedDB.databases()).map(({ name }) => name);

/** The wallet setup in place of every one here, unlocked, then another added. */
async function twoWallets() {
  await vault.setUp(A, PASSWORD);
  await unlockWallets(PASSWORD);

  const [first] = vault.list() ?? [];
  const second = await addWallet(B, PASSWORD, { syncFrom: 0n });

  return { first, second };
}

/**
 * What the browser gives this tab as another tab tells it something.
 *
 * @param {import("../tabs").TabEvent} event
 */
function fromOtherTab(event) {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: EVENT,
      newValue: JSON.stringify({ ...event, id: crypto.randomUUID() }),
      storageArea: localStorage,
    })
  );
}

describe("The wallets on this device", () => {
  // A lock, without leaving the page.
  const logoutSpy = vi
    .spyOn(navigation, "logout")
    .mockImplementation(async () => walletStore.reset());

  vi.spyOn(Bookkeeper.prototype, "minimumStake", "get").mockResolvedValue(1n);
  vi.spyOn(Bookkeeper.prototype, "balance").mockResolvedValue(
    /** @type {any} */ ({ nonce: 0n, spendable: 0n, value: 0n })
  );
  vi.spyOn(Bookkeeper.prototype, "stakeInfo").mockResolvedValue(
    /** @type {any} */ ({ amount: null, faults: 0, hardFaults: 0, reward: 0n })
  );
  vi.spyOn(networkStore, "checkBlock").mockResolvedValue(true);
  vi.spyOn(networkStore, "getBlockHashByHeight").mockResolvedValue("hash");
  vi.spyOn(networkStore, "getLastFinalizedBlockHeight").mockResolvedValue(1n);

  /** @type {(() => void) | null} */
  let stopFollowing = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    stopFollowing?.();
    stopFollowing = null;
    walletStore.reset();
    settingsStore.reset();
    await vault.clear();
    localStorage.clear();
    logoutSpy.mockClear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("unlocking", () => {
    it("opens every wallet the password opens, the phrase of earlier versions moved in, with the data kept before as its own", async () => {
      const { address } = await firstProfileOf(fixtures.current.mnemonic);

      localStorage.setItem(V1, fixtures.current.stored);
      localStorage.setItem(MIGRATIONS, "[]");
      settingsStore.update((s) => ({ ...s, userId: String(address) }));

      await unlockWallets(fixtures.current.password);

      const [moved] = vault.list() ?? [];

      expect(moved.id).toMatch(/^v1-[0-9a-f]{32}$/);
      expect(localStorage.getItem(V1)).toBeNull();
      expect(get(walletStore)).toMatchObject({
        initialized: true,
        walletKey: moved.id,
        wallets: [{ key: moved.id, n: 1 }],
      });
      expect(readDirectory()).toMatchObject({
        active: moved.id,
        legacy: moved.id,
      });
      expect(walletDataSuffix()).toBe("");
      expect(localStorage.getItem(MIGRATIONS)).toBe("[]");
    });

    it("leaves the data kept before to the wallet here that has it, and gives a moved phrase the settings don't name its own", async () => {
      // A wallet here under another password has the data of before; an
      // older version, back for a while, kept another phrase.
      await vault.setUp(C, "an older password");

      const [other] = vault.list() ?? [];

      await setLegacyWallet(other.id);
      localStorage.setItem(V1, fixtures.current.stored);
      localStorage.setItem(MIGRATIONS, "[]");
      settingsStore.update((s) => ({ ...s, userId: "another wallet" }));

      await unlockWallets(fixtures.current.password);

      const moved = /** @type {{ id: string }} */ (
        vault.list()?.find(({ id }) => id !== other.id)
      );

      expect(readDirectory().legacy).toBe(other.id);
      expect(walletDataSuffix()).toBe(`:${moved.id}`);
      expect(localStorage.getItem(MIGRATIONS)).toBe("[]");
    });

    it("keeps the wallet whose phrase is in v1, and its data, while its move is still to come", async () => {
      const { address } = await firstProfileOf(fixtures.current.mnemonic);
      const setItem = Storage.prototype.setItem;
      const failing = vi.spyOn(Storage.prototype, "setItem").mockImplementation(
        /**
         * @this {Storage}
         * @param {string} key
         * @param {string} value
         */
        function (key, value) {
          if (key === `${APP}-login-v2` && vault.list()?.length === 1) {
            throw new Error("full");
          }

          return setItem.call(this, key, value);
        }
      );

      // Another wallet's v2 here, under another password, and v1 beside it.
      await vault.setUp(C, "an older password");
      localStorage.setItem(V1, fixtures.current.stored);
      localStorage.setItem(MIGRATIONS, "[]");
      settingsStore.update((s) => ({ ...s, userId: String(address) }));

      try {
        // Twice, the move cut short each time.
        for (let i = 0; i < 2; i++) {
          walletStore.reset();
          await unlockWallets(fixtures.current.password);
        }
      } finally {
        failing.mockRestore();
      }

      const { walletKey } = get(walletStore);

      expect(localStorage.getItem(V1)).toBe(fixtures.current.stored);
      expect(walletKey).toMatch(/^v1-/);
      expect(readDirectory()).toMatchObject({
        legacy: walletKey,
        wallets: { [walletKey]: expect.any(Object) },
      });
      expect(localStorage.getItem(MIGRATIONS)).toBe("[]");
    });

    it("forgets the wallets the vault doesn't hold any more, with their data", async () => {
      await vault.setUp(A, PASSWORD);
      await noteActiveWallet("gone", {
        accounts: ["gone-account"],
        addresses: ["gone-address"],
      });
      localStorage.setItem(`${MIGRATIONS}:gone`, "[]");

      await unlockWallets(PASSWORD);

      expect(Object.keys(readDirectory().wallets)).toEqual([
        vault.list()?.[0].id,
      ]);
      expect(localStorage.getItem(`${MIGRATIONS}:gone`)).toBeNull();
    });

    it("refuses a wrong password, and opens nothing", async () => {
      await vault.setUp(A, PASSWORD);

      await expect(unlockWallets("password12")).rejects.toBeInstanceOf(
        InvalidPasswordError
      );
      expect(get(walletStore).initialized).toBe(false);
    });
  });

  describe("adding", () => {
    it("refuses a phrase that's here already and a wrong password, then opens the new wallet, with data of its own", async () => {
      await vault.setUp(A, PASSWORD);
      await unlockWallets(PASSWORD);

      const [first] = vault.list() ?? [];

      for (const phrase of [A, `  ${A.replaceAll(" ", "  ")}\n`]) {
        await expect(addWallet(phrase, PASSWORD)).rejects.toThrow(
          DUPLICATE_PHRASE
        );
      }

      await expect(addWallet(B, "password12")).rejects.toBeInstanceOf(
        InvalidPasswordError
      );
      expect(vault.list()).toEqual([first]);
      expect(get(walletStore).walletKey).toBe(first.id);

      const second = await addWallet(B, PASSWORD, {
        height: 7n,
        syncFrom: 7n,
      });

      expect(second).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{32}$/),
        n: 2,
      });
      expect(get(walletStore)).toMatchObject({
        walletKey: second.id,
        wallets: [
          { key: first.id, n: 1 },
          { key: second.id, n: 2 },
        ],
      });
      expect(walletDataSuffix()).toBe(`:${second.id}`);
      expect(readDirectory()).toMatchObject({
        active: second.id,
        wallets: { [second.id]: { height: "7" } },
      });
      expect(String(get(walletStore).profiles[0].account)).toBe(
        String((await firstProfileOf(B)).account)
      );
    });

    it("adds nothing, and opens nothing, once this tab locks while a wallet is being added", async () => {
      await vault.setUp(A, PASSWORD);
      await unlockWallets(PASSWORD);

      const [first] = vault.list() ?? [];
      const adding = addWallet(B, PASSWORD).catch((error) => error);

      await lockWallets();

      expect(await adding).toEqual(new WalletChangedError());
      expect(vault.list()).toEqual([first]);
      expect(get(walletStore)).toMatchObject({
        initialized: false,
        walletKey: "",
        wallets: [],
      });
    });
  });

  describe("switching", () => {
    it("opens another wallet without the password, with the same two profiles each time", async () => {
      const { first, second } = await twoWallets();
      const secondAccounts = accounts();

      await switchToWallet(first.id, 1);

      const firstAccounts = accounts();

      expect(get(walletStore).walletKey).toBe(first.id);
      expect(get(walletStore).currentProfile).toBe(
        get(walletStore).profiles[1]
      );
      expect(firstAccounts).not.toEqual(secondAccounts);
      expect(lastEvent()).toMatchObject({
        key: first.id,
        profile: 1,
        type: "switch",
      });

      await switchToWallet(second.id);

      expect(accounts()).toEqual(secondAccounts);

      await switchToWallet(first.id);

      expect(accounts()).toEqual(firstAccounts);
      expect(readDirectory().active).toBe(first.id);
    });

    it("lets nothing drawn for one wallet act once another opens", async () => {
      const { first } = await twoWallets();
      const task = vi.fn(async () => "sent");
      const send = walletStore.forThisWallet()(task);

      await switchToWallet(first.id);

      await expect(send()).rejects.toEqual(new WalletChangedError());
      expect(task).not.toHaveBeenCalled();
      await expect(walletStore.forThisWallet()(task)()).resolves.toBe("sent");
    });

    it("sends nothing of a send begun on one wallet when another opens while it syncs", async () => {
      const { first } = await twoWallets();

      await vi.waitFor(() =>
        expect(get(walletStore).syncStatus.isInProgress).toBe(false)
      );

      const execute = vi.spyOn(Network.prototype, "execute");
      const pending = Promise.withResolvers();

      vi.spyOn(
        WalletTreasury.prototype,
        "getCachedSyncInfo"
      ).mockReturnValueOnce(/** @type {any} */ (pending.promise));

      const transfer = walletStore
        .transfer(
          String(get(walletStore).profiles[1].account),
          1n,
          "",
          new Gas({ limit: 10_000_000n, price: 1n })
        )
        .catch((error) => error);

      await switchToWallet(first.id);
      pending.resolve({
        block: { hash: "", height: 0n },
        bookmark: 0n,
        lastFinalizedBlockHeight: 0n,
      });

      expect(await transfer).toEqual(new WalletChangedError());
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("removing", () => {
    it("takes one wallet's phrase and data with the password, and leaves the other's", async () => {
      const { first, second } = await twoWallets();

      await vi.waitFor(async () =>
        expect(await databases()).toContain(`${CACHE}:${second.id}`)
      );

      const own = {
        [first.id]: String((await firstProfileOf(A)).account),
        [second.id]: String((await firstProfileOf(B)).account),
      };

      for (const { id } of [first, second]) {
        localStorage.setItem(`${MIGRATIONS}:${id}`, "[]");
        await putLocalTransaction(`testnet::${own[id]}`, { hash: id });
      }

      localStorage.setItem(
        CONTACTS,
        JSON.stringify({
          [await contactsNamespace(own[first.id])]: { kept: 1 },
          [await contactsNamespace(own[second.id])]: { kept: 2 },
        })
      );

      await expect(
        removeWallet(second.id, "password12")
      ).rejects.toBeInstanceOf(InvalidPasswordError);
      expect(vault.list()).toHaveLength(2);
      expect(get(walletStore).walletKey).toBe(second.id);

      // The open one: the other opens first.
      await removeWallet(second.id, PASSWORD);

      expect(vault.list()).toEqual([first]);
      expect(get(walletStore)).toMatchObject({
        walletKey: first.id,
        wallets: [{ key: first.id, n: 1 }],
      });
      expect(Object.keys(readDirectory().wallets)).toEqual([first.id]);
      expect(localStorage.getItem(`${MIGRATIONS}:${second.id}`)).toBeNull();
      expect(localStorage.getItem(`${MIGRATIONS}:${first.id}`)).toBe("[]");
      expect(
        Object.values(JSON.parse(localStorage.getItem(CONTACTS) ?? "{}"))
      ).toEqual([{ kept: 1 }]);
      expect(await databases()).not.toContain(`${CACHE}:${second.id}`);
      expect(await databases()).toContain(`${CACHE}:${first.id}`);
      expect(lastEvent()).toMatchObject({ type: "wallets" });

      const { listLocalTransactions } =
        await import("$lib/activity/activityStore");

      expect(await listLocalTransactions(`testnet::${own[second.id]}`)).toEqual(
        []
      );
      expect(
        await listLocalTransactions(`testnet::${own[first.id]}`)
      ).toHaveLength(1);

      await expect(removeWallet(first.id, PASSWORD)).rejects.toThrow(
        ONLY_WALLET
      );
    });
  });

  describe("naming", () => {
    it("names a wallet only on this device, and gives it its number back with none", async () => {
      const { first } = await twoWallets();

      await renameWallet(first.id, "  Savings   jar ");

      expect(get(walletDirectory).wallets[first.id].name).toBe("Savings jar");
      expect(
        walletLabel({ n: 1, ...get(walletDirectory).wallets[first.id] })
      ).toBe("Savings jar");
      expect(vault.list()?.[0]).toEqual(first);

      await renameWallet(first.id, " ");

      expect(get(walletDirectory).wallets[first.id]).not.toHaveProperty("name");
      expect(walletLabel({ n: 1 })).toBe("Wallet 1");
    });
  });

  describe("a new password", () => {
    it("seals every wallet again, the old password opening none, and tells the other tabs", async () => {
      const { first, second } = await twoWallets();

      await expect(
        changeWalletPassword("password12", "a new password")
      ).rejects.toBeInstanceOf(InvalidPasswordError);

      await changeWalletPassword(PASSWORD, "a new password");

      await expect(vault.unlock(PASSWORD)).rejects.toBeInstanceOf(
        InvalidPasswordError
      );
      expect(
        (await vault.unlock("a new password")).wallets.map(({ id }) => id)
      ).toEqual([first.id, second.id]);
      expect(lastEvent()).toMatchObject({ type: "password" });
    });
  });

  describe("locking", () => {
    it("locks every wallet, here and in the other tabs", async () => {
      const { first, second } = await twoWallets();

      await lockWallets();

      expect(get(walletStore)).toMatchObject({
        initialized: false,
        walletKey: "",
        wallets: [],
      });
      expect(walletStore.heldWallet(first.id)).toBeNull();
      expect(walletStore.heldWallet(second.id)).toBeNull();
      expect(lastEvent()).toMatchObject({ type: "lock" });
    });
  });

  describe("two tabs", () => {
    it("tells the other tabs what it does, as they hear it", () => {
      /** @type {unknown[]} */
      const heard = [];
      const stop = onOtherTabs((event) => heard.push(event));

      tellOtherTabs({ key: "k", profile: 1, type: "switch" });

      // The browser tells the other tabs, never the one that wrote.
      expect(heard).toEqual([]);

      window.dispatchEvent(
        new StorageEvent("storage", {
          key: EVENT,
          newValue: localStorage.getItem(EVENT),
          storageArea: localStorage,
        })
      );

      expect(heard).toEqual([
        { id: expect.any(String), key: "k", profile: 1, type: "switch" },
      ]);
      stop();
    });

    it("opens here, without the password, the wallet another tab opened, at its profile", async () => {
      const { first } = await twoWallets();

      stopFollowing = followOtherTabs();
      fromOtherTab({ key: first.id, profile: 1, type: "switch" });

      await vi.waitFor(() => expect(get(walletStore).walletKey).toBe(first.id));
      expect(get(walletStore).currentProfile).toBe(
        get(walletStore).profiles[1]
      );
      expect(logoutSpy).not.toHaveBeenCalled();
    });

    it.each([
      [
        "opens a wallet this tab doesn't hold",
        { key: "added", profile: 0, type: "switch" },
      ],
      ["locks", { type: "lock" }],
      ["changes the password", { type: "password" }],
    ])("locks this tab when another %s", async (_what, event) => {
      await twoWallets();

      stopFollowing = followOtherTabs();
      fromOtherTab(/** @type {import("../tabs").TabEvent} */ (event));

      await vi.waitFor(() => expect(logoutSpy).toHaveBeenCalledTimes(1));
      expect(get(walletStore).initialized).toBe(false);
    });

    it("lets go of a wallet another tab removed, after opening the one that tab opened", async () => {
      const { first, second } = await twoWallets();

      stopFollowing = followOtherTabs();

      // In the other tab: the first opened, then the second removed.
      await noteActiveWallet(first.id, { accounts: [], addresses: [] });
      await vault.remove(second.id, PASSWORD);
      fromOtherTab({ key: first.id, profile: 0, type: "switch" });
      fromOtherTab({ type: "wallets" });

      await vi.waitFor(() =>
        expect(get(walletStore).wallets).toEqual([{ key: first.id, n: 1 }])
      );
      expect(get(walletStore).walletKey).toBe(first.id);
      expect(logoutSpy).not.toHaveBeenCalled();
    });
  });
});
