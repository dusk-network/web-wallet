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
import { Network } from "@dusk/w3sper";
import { networks } from "@dusk-network/networks";

import { finalizeWithdrawal, proveWithdrawal } from "$lib/bridge/withdrawals";
import { keptMigrations } from "$lib/bridge/migrationActivity";
import {
  rememberHistoryWithdrawals,
  withdrawalActivityStore,
} from "$lib/bridge/withdrawalActivity";
import { cardRoutes } from "$lib/bridge/cardRoutes";
import { sendMigration } from "$lib/bridge/routeFlows";
import { WalletChangedError } from "$lib/errors";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { settingsStore, walletStore } from "$lib/stores";
import { stubWalletNetwork } from "$lib/test-helpers";
import vault from "$lib/vault";

import { suffixOf } from "../dataNames";
import { readDirectory } from "../directory";
import { addWallet, switchToWallet, unlockWallets } from "..";

// Each wallet's profiles their own accounts, as on the network.
vi.mock("$lib/mocks/ProtocolDriver", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  generateProfile: (await import("$lib/test-helpers/distinctProfile")).default,
}));

/** What DuskEVM's withdrawals package answers, when the test says. */
const pkg = vi.hoisted(() => ({
  claimCall: vi.fn(),
  prepareProof: vi.fn(),
}));

/** The EVM wallet's side of a migration, when the test says. */
const evm = vi.hoisted(() => ({
  allowance: vi.fn(),
  approve: vi.fn(),
  migrate: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

/** DuskEVM's explorer, asked for withdrawals by their nonces. */
const explorer = vi.hoisted(() => ({ findWithdrawalsByNonce: vi.fn() }));

vi.mock("$lib/bridge/blockscoutWithdrawalActivity", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  findWithdrawalsByNonce: explorer.findWithdrawalsByNonce,
}));

vi.mock(
  "@dusk-network/app-core/duskevm-withdrawals",
  async (importOriginal) => ({
    .../** @type {object} */ (await importOriginal()),
    createWithdrawals: () => pkg,
  })
);

vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");
  const { duskEvm } = await import("$lib/web3/duskEvm");

  return {
    account: writable({ address: undefined, isConnected: false }),
    duskEvm,
    modal: { open: vi.fn() },
    wagmiConfig: {},
  };
});

vi.mock("@wagmi/core", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  waitForTransactionReceipt: evm.waitForTransactionReceipt,
}));

vi.mock("$lib/web3/migration", () => ({
  allowance: evm.allowance,
  approve: evm.approve,
  getBalanceOfCoin: vi.fn(),
  migrate: evm.migrate,
}));

const APP = CONFIG.LOCAL_STORAGE_APP_KEY;
const PASSWORD = "password123";
const TX = /** @type {`0x${string}`} */ (`0x${"57".repeat(32)}`);
const MIGRATED = /** @type {`0x${string}`} */ (`0x${"4d".repeat(32)}`);
const MIGRATED_NEXT = /** @type {`0x${string}`} */ (`0x${"4e".repeat(32)}`);
const WITHDRAWN = /** @type {`0x${string}`} */ (`0x${"8e".repeat(32)}`);
const OWNER = /** @type {`0x${string}`} */ (
  "0x2222222222222222222222222222222222222222"
);
const PORTAL = String(
  networks.testnet.duskEvm?.contracts.optimism_portal.contractId
);

// Public BIP39 test phrases, never a real wallet's.
const A =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const B =
  "scheme spot photo card baby mountain device kick cradle pact join borrow";

/** A proof or a claim as the package hands it over. */
const portalCall = (/** @type {string} */ fnName) => ({
  args: {},
  contractId: PORTAL,
  decoded: { kind: fnName },
  deposit: 0n,
  fnArgs: Uint8Array.of(9),
  fnName,
  gasLimit: 51_500_000n,
});

const BSC = /** @type {any} */ (
  cardRoutes(networks.mainnet).find(({ id }) => id === "bsc-to-dusk")
);

/**
 * The migrations kept under a wallet's own names.
 *
 * @param {string} key
 * @returns {Array<{ hash: string }>}
 */
const migrationsOf = (key) =>
  JSON.parse(
    localStorage.getItem(
      `${APP}-migrations${suffixOf(key, readDirectory().legacy)}`
    ) ?? "[]"
  );

/**
 * One wallet, then another added, which opens; the first is the one
 * switched to while something begun on the second waits.
 */
async function twoWallets() {
  await vault.setUp(A, PASSWORD);
  await unlockWallets(PASSWORD);

  const [first] = vault.list() ?? [];
  const second = await addWallet(B, PASSWORD, { syncFrom: 0n });

  await vi.waitFor(() =>
    expect(get(walletStore).syncStatus.isInProgress).toBe(false)
  );

  return { first, second };
}

describe("Work begun on one wallet", () => {
  stubWalletNetwork();

  const execute = vi.spyOn(Network.prototype, "execute");

  // The test profiles' accounts aren't real ones a DuskEVM address is
  // made from.
  vi.spyOn(walletStore, "getDuskEvmProofSubmitter").mockReturnValue(
    `0x${"97".repeat(20)}`
  );

  beforeEach(() => {
    localStorage.clear();
    setNodeNetwork(networks.testnet);

    for (const fake of [...Object.values(evm), ...Object.values(pkg)]) {
      fake.mockReset();
    }

    explorer.findWithdrawalsByNonce.mockReset();
    execute.mockReset();
    execute.mockResolvedValue(
      /** @type {any} */ ({ hash: "aa".repeat(32), nonce: 1n })
    );
  });

  afterEach(async () => {
    walletStore.reset();
    settingsStore.reset();
    await vault.clear();
    localStorage.clear();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("sends no claim and no proof once another wallet opened while it was made, and says so", async () => {
    const { first, second } = await twoWallets();

    /** @type {Array<{ act: (hash: `0x${string}`) => Promise<string>, made: import("vitest").Mock, ready: unknown }>} */
    const sends = [
      {
        act: finalizeWithdrawal,
        made: pkg.claimCall,
        ready: portalCall("finalizeWithdrawalTransaction"),
      },
      {
        act: proveWithdrawal,
        made: pkg.prepareProof,
        ready: {
          at: Date.now(),
          call: portalCall("proveWithdrawalTransaction"),
        },
      },
    ];

    for (const { act, made, ready } of sends) {
      const making = Promise.withResolvers();
      const other =
        get(walletStore).walletKey === first.id ? second.id : first.id;

      made.mockReturnValueOnce(making.promise);

      const acting = act(TX).catch((error) => error);

      await switchToWallet(other);
      making.resolve(ready);

      const said = await acting;

      expect(said).toEqual(new WalletChangedError());
      expect(String(said)).toContain("The wallet changed meanwhile.");
    }

    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps a migration sent while another wallet opened for the wallet it was sent for, and sends none once it opened before the migration went out", async () => {
    const { first, second } = await twoWallets();
    const account = String(get(walletStore).profiles[0].account);
    const sent = Promise.withResolvers();

    evm.allowance.mockResolvedValue(10n ** 30n);
    evm.migrate.mockReturnValueOnce(sent.promise);
    evm.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const migrating = sendMigration({
      amountLux: 1_000_000_000n,
      owner: "0x2222222222222222222222222222222222222222",
      recipient: account,
      route: BSC,
    });

    await vi.waitFor(() => expect(evm.migrate).toHaveBeenCalledOnce());
    await switchToWallet(first.id);
    sent.resolve(MIGRATED);
    await migrating;

    // Kept, confirmed, for the wallet that sent it, and only there.
    expect(migrationsOf(second.id)).toMatchObject([
      { confirmed: true, hash: MIGRATED, recipient: account },
    ]);
    expect(migrationsOf(first.id)).toEqual([]);
    expect(get(keptMigrations)).toEqual([]);

    await switchToWallet(second.id);

    expect(get(keptMigrations)).toMatchObject([{ hash: MIGRATED }]);

    // Another opened while the allowance was read: nothing is approved,
    // nothing migrates.
    const read = Promise.withResolvers();

    evm.allowance.mockReturnValueOnce(read.promise);

    const refused = sendMigration({
      amountLux: 1_000_000_000n,
      owner: "0x2222222222222222222222222222222222222222",
      recipient: account,
      route: BSC,
    }).catch((error) => error);

    await switchToWallet(first.id);
    read.resolve(0n);

    expect(await refused).toEqual(new WalletChangedError());
    expect(evm.approve).not.toHaveBeenCalled();
    expect(evm.migrate).toHaveBeenCalledOnce();
  });

  it("keeps a migration sent while its wallet was left and opened again, shown, and keeps it as the next one is kept", async () => {
    const { first, second } = await twoWallets();
    const recipient = String(get(walletStore).profiles[0].account);
    const sent = Promise.withResolvers();
    const migration = { amountLux: 1_000_000_000n, owner: OWNER, recipient };

    evm.allowance.mockResolvedValue(10n ** 30n);
    evm.migrate
      .mockReturnValueOnce(sent.promise)
      .mockResolvedValueOnce(MIGRATED_NEXT);
    evm.waitForTransactionReceipt.mockResolvedValue({ status: "success" });

    const migrating = sendMigration({ ...migration, route: BSC });

    await vi.waitFor(() => expect(evm.migrate).toHaveBeenCalledOnce());
    await switchToWallet(first.id);
    await switchToWallet(second.id);
    sent.resolve(MIGRATED);
    await migrating;

    expect(get(keptMigrations)).toMatchObject([
      { confirmed: true, hash: MIGRATED },
    ]);

    await sendMigration({ ...migration, route: BSC });

    expect(migrationsOf(second.id).map(({ hash }) => hash)).toEqual([
      MIGRATED_NEXT,
      MIGRATED,
    ]);
    expect(get(keptMigrations).map(({ hash }) => hash)).toEqual([
      MIGRATED_NEXT,
      MIGRATED,
    ]);
  });

  it("keeps the withdrawals its history finds while its wallet was left and opened again, and shows them", async () => {
    const { first, second } = await twoWallets();
    const looking = Promise.withResolvers();

    explorer.findWithdrawalsByNonce.mockReturnValueOnce(looking.promise);

    const finding = rememberHistoryWithdrawals([
      { hash: WITHDRAWN, nonce: 7n, recipient: null },
    ]);

    await switchToWallet(first.id);
    await switchToWallet(second.id);
    looking.resolve(
      new Map([
        [
          "7",
          {
            account: OWNER,
            amountWei: 1n,
            createdAt: 1,
            transactionHash: TX,
          },
        ],
      ])
    );
    await finding;

    expect(get(withdrawalActivityStore)).toMatchObject([
      { transactionHash: TX, withdrawalHash: WITHDRAWN },
    ]);
  });
});
