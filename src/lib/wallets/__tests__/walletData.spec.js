import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";

import {
  commitActivityStep,
  getShieldedHistoryRecord,
  listActivityEntries,
  listLocalTransactions,
  putLocalTransaction,
  putShieldedHistoryRecord,
} from "$lib/activity/activityStore";
import { rememberDepositTransaction } from "$lib/bridge/depositActivityStorage";
import {
  keptMigrations,
  rememberMigration,
} from "$lib/bridge/migrationActivity";
import {
  closeContacts,
  contactsWritten,
  listContacts,
  openContacts,
  saveContact,
} from "$lib/contacts";
import {
  getVerifiedName,
  keepVerifiedName,
} from "$lib/dusk-domains/verifiedNames";
import { walletCacheFor } from "$lib/wallet-cache";

import { startIncarnation, walletDataName } from "../dataNames";
import { setLegacyWallet, startDirectory } from "../directory";
import {
  forgetEveryWalletData,
  forgetOtherWalletsData,
  forgetWalletData,
  useWalletData,
} from "../walletData";

const APP = CONFIG.LOCAL_STORAGE_APP_KEY;
const CACHE = "@dusk-network/wallet-cache";

/** Two wallets: their vault IDs, accounts, addresses and seeds. */
const ONE = {
  account: "account-of-one",
  address: "address-of-one",
  key: "one",
  seed: new Uint8Array(64).fill(1),
};
const TWO = {
  account: "account-of-two",
  address: "address-of-two",
  key: "two",
  seed: new Uint8Array(64).fill(2),
};

const databases = async () =>
  (await indexedDB.databases()).map(({ name }) => name);

const migration = {
  amountLux: "1",
  createdAt: 1,
  hash: `0x${"ab".repeat(32)}`,
  recipient: "r",
  routeId: "bsc",
  sender: "s",
};

/**
 * Keeps something of every kind for a wallet, while it's open.
 *
 * @param {typeof ONE} wallet
 */
async function keepDataOf(wallet) {
  useWalletData(wallet.key);
  await walletCacheFor(walletDataName("")).setSyncInfo({
    block: { hash: wallet.key, height: 1n },
    bookmark: 1n,
    lastFinalizedBlockHeight: 1n,
  });
  rememberDepositTransaction("aa".repeat(32), { account: null });
  rememberMigration(migration);
  keepVerifiedName("testnet", wallet.account, `${wallet.key}.dusk`);
  await openContacts({ account: wallet.account, seed: wallet.seed });
  saveContact({ address: "somewhere", name: `Friend of ${wallet.key}` });
  await contactsWritten();
  closeContacts();
  await putLocalTransaction(`testnet::${wallet.account}`, { hash: "h" });
  await commitActivityStep(
    `testnet::${wallet.account}`,
    [/** @type {any} */ ({ blockHeight: 1, hash: "h" })],
    () => /** @type {any} */ ({ from: 0, to: 1 })
  );
  await putShieldedHistoryRecord(
    `testnet::${wallet.address}`,
    /** @type {any} */ ({ entries: [] })
  );
}

/**
 * What's kept of a wallet: read back while it's open.
 *
 * @param {typeof ONE} wallet
 */
async function dataOf(wallet) {
  useWalletData(wallet.key);
  await openContacts({ account: wallet.account, seed: wallet.seed });

  const contacts = listContacts().map(({ name }) => name);

  closeContacts();

  return {
    cache: (await walletCacheFor(walletDataName("")).getSyncInfo()).block.hash,
    contacts,
    deposits: JSON.parse(
      localStorage.getItem(walletDataName("dusk-evm:deposit-activity:v1")) ??
        "[]"
    ).length,
    entries: (await listActivityEntries(`testnet::${wallet.account}`)).length,
    local: (await listLocalTransactions(`testnet::${wallet.account}`)).length,
    migrations: get(keptMigrations).length,
    name: getVerifiedName("testnet", wallet.account),
    shielded: Boolean(
      await getShieldedHistoryRecord(`testnet::${wallet.address}`)
    ),
  };
}

const allOf = (/** @type {typeof ONE} */ wallet) => ({
  cache: wallet.key,
  contacts: [`Friend of ${wallet.key}`],
  deposits: 1,
  entries: 1,
  local: 1,
  migrations: 1,
  name: `${wallet.key}.dusk`,
  shielded: true,
});

const NONE = {
  cache: "",
  contacts: [],
  deposits: 0,
  entries: 0,
  local: 0,
  migrations: 0,
  name: "",
  shielded: false,
};

describe("Each wallet's data", () => {
  beforeEach(async () => {
    localStorage.clear();
    // Both set up here, each with its incarnation.
    startIncarnation(ONE.key);
    startIncarnation(TWO.key);
    await startDirectory(ONE.key);
  });

  afterEach(async () => {
    await forgetEveryWalletData();
    closeContacts();
    localStorage.clear();
  });

  it("keeps the wallet with the names of before under them, and each other wallet under its own", async () => {
    await keepDataOf(ONE);
    await keepDataOf(TWO);

    expect(localStorage.getItem(`${APP}-migrations`)).not.toBeNull();
    expect(localStorage.getItem(`${APP}-migrations:two`)).not.toBeNull();
    expect(localStorage.getItem("dusk-evm:deposit-activity:v1")).not.toBeNull();
    expect(
      localStorage.getItem("dusk-evm:deposit-activity:v1:two")
    ).not.toBeNull();
    expect(await databases()).toEqual(
      expect.arrayContaining([CACHE, `${CACHE}:two`])
    );

    // Neither shows the other's.
    expect(await dataOf(ONE)).toStrictEqual(allOf(ONE));
    expect(await dataOf(TWO)).toStrictEqual(allOf(TWO));
  });

  it("forgets one removed wallet's data, and nothing of another's", async () => {
    await keepDataOf(ONE);
    await keepDataOf(TWO);

    await expect(
      forgetWalletData(TWO.key, {
        accounts: [TWO.account],
        addresses: [TWO.address],
      })
    ).resolves.toBe(true);
    expect(await databases()).not.toContain(`${CACHE}:two`);
    expect(await databases()).toContain(CACHE);

    expect(await dataOf(TWO)).toStrictEqual(NONE);
    expect(await dataOf(ONE)).toStrictEqual(allOf(ONE));
  });

  it("forgets the data of the wallet with the names of before, when that one is removed", async () => {
    await keepDataOf(ONE);
    await keepDataOf(TWO);

    await forgetWalletData(ONE.key, {
      accounts: [ONE.account],
      addresses: [ONE.address],
    });
    await setLegacyWallet("");

    expect(await dataOf(TWO)).toStrictEqual(allOf(TWO));
    expect(localStorage.getItem(`${APP}-migrations`)).toBeNull();
  });

  it("forgets every other wallet's own data for a wallet set up in place of them, and every one's for a reset", async () => {
    await keepDataOf(ONE);
    await keepDataOf(TWO);
    await startDirectory(ONE.key);

    // The directory, once a setup took the place of the wallets, knows only the new one.
    await import("../directory").then(({ noteActiveWallet }) =>
      noteActiveWallet(TWO.key, { accounts: [], addresses: [] })
    );
    await forgetOtherWalletsData();

    expect(localStorage.getItem(`${APP}-migrations:two`)).toBeNull();
    expect(await databases()).not.toContain(`${CACHE}:two`);
    expect(localStorage.getItem(`${APP}-migrations`)).not.toBeNull();

    await forgetEveryWalletData();

    expect(localStorage.getItem(`${APP}-migrations`)).toBeNull();
    expect((await walletCacheFor("").getSyncInfo()).block.hash).toBe("");
  });

  it("drops a change of a removed wallet's contacts begun before the removal, and keeps another wallet's", async () => {
    await openContacts({ account: TWO.account, seed: TWO.seed });
    saveContact({ address: "somewhere", name: "Kept as it was being made" });

    // Another tab removes the wallet while the change is kept.
    await forgetWalletData(TWO.key, {
      accounts: [TWO.account],
      addresses: [TWO.address],
    });
    await contactsWritten();
    closeContacts();

    expect(localStorage.getItem(`${APP}-encrypted-contacts`)).toBeNull();

    await keepDataOf(ONE);

    expect((await dataOf(ONE)).contacts).toEqual([`Friend of ${ONE.key}`]);
  });
});
