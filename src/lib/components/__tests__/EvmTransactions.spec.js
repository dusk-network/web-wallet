import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";

import { tick } from "svelte";
import { get } from "svelte/store";

import { EvmTransactions } from "..";
import WithdrawalLifecycle from "../EvmTransactions/WithdrawalLifecycle.svelte";
import { rowsOf } from "$lib/activity/__tests__/fixtures/rows";
import { claimDay } from "$lib/bridge/claimDate";
import { WITHDRAWAL_GAS_REFUSAL } from "$lib/bridge/withdrawalLifecycle";
import { formatTimestamp } from "../EvmTransactions/withdrawalPresentation";
import { networks } from "@dusk-network/networks";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { walletStore } from "$lib/stores";

const mocks = vi.hoisted(() => {
  const configuredFinalizationConfig = () =>
    /** @type {{ configured: boolean, disputeGameFactoryContractId: string | undefined, disputeGameFactoryDataDriverUrl: string, l2RpcUrl: string, missing: string[], optimismPortalContractId: string | undefined, optimismPortalDataDriverUrl: string }} */ ({
      configured: true,
      disputeGameFactoryContractId: "22".repeat(32),
      disputeGameFactoryDataDriverUrl: "/dispute_game_factory_dd_opt.wasm",
      l2RpcUrl: "https://rpc.devnet.duskevm.dusk.network",
      missing: [],
      optimismPortalContractId: "11".repeat(32),
      optimismPortalDataDriverUrl: "/optimism_portal_dd_opt.wasm",
    });
  /** @type {Set<(value: any) => void>} */
  const subscribers = new Set();
  /** @type {Set<(value: any[]) => void>} */
  const activitySubscribers = new Set();
  let accountValue = {
    address: undefined,
    isConnected: false,
  };
  /** @type {any[]} */
  let withdrawalItems = [];
  /** @type {Set<(value: any) => void>} */
  const historySubscribers = new Set();
  let historyValue = { rows: /** @type {any[]} */ ([]) };
  /** @type {Set<(value: any) => void>} */
  const pageSubscribers = new Set();
  const pageAt = (/** @type {string} */ search) => ({
    data: {},
    error: null,
    form: undefined,
    params: {},
    route: { id: "/(app)/dashboard/bridge/transactions" },
    status: 200,
    url: new URL(`http://localhost/dashboard/bridge/transactions${search}`),
  });
  let pageValue = pageAt("");
  /** @type {Set<(value: any[]) => void>} */
  const depositSubscribers = new Set();
  /** @type {any[]} */
  let depositItems = [];
  /** @type {Set<(value: any) => void>} */
  const timesSubscribers = new Set();
  let timesValue = { chain: /** @type {any} */ (null), network: "testnet" };
  const account = {
    /**
     * @param {(value: any) => void} run
     */
    subscribe(run) {
      subscribers.add(run);
      run(accountValue);

      return () => subscribers.delete(run);
    },
  };
  const withdrawalActivityStore = {
    /**
     * @param {(value: any[]) => void} run
     */
    subscribe(run) {
      activitySubscribers.add(run);
      run(withdrawalItems);

      return () => activitySubscribers.delete(run);
    },
  };

  return {
    account,
    activityState: {
      /** @param {(value: any) => void} run */
      subscribe(run) {
        historySubscribers.add(run);
        run(historyValue);

        return () => historySubscribers.delete(run);
      },
    },
    bridgeTimes: {
      load: vi.fn(() => Promise.resolve()),
      /** @param {(value: any) => void} run */
      subscribe(run) {
        timesSubscribers.add(run);
        run(timesValue);

        return () => timesSubscribers.delete(run);
      },
    },
    configuredFinalizationConfig,
    depositActivityStore: {
      /** @param {(value: any[]) => void} run */
      subscribe(run) {
        depositSubscribers.add(run);
        run(depositItems);

        return () => depositSubscribers.delete(run);
      },
    },
    finalizationConfig: configuredFinalizationConfig(),
    finalizeWithdrawal: vi.fn(),
    followHistoryDeposits: vi.fn(() => new Set()),
    historyWithdrawals: vi.fn(() => /** @type {any[]} */ ([])),
    hydrateDepositActivity: vi.fn(() => depositItems),
    hydrateWithdrawalActivity: vi.fn(() => withdrawalItems),
    loadDuskTransactionExecution: vi.fn(),
    loadProveNowClaim: vi.fn(() => Promise.resolve(/** @type {any} */ (null))),
    loadWithdrawalActivity: vi.fn(),
    loadWithdrawalStatus: vi.fn(),
    mergeWithdrawalActivity: vi.fn((remembered, indexed) => {
      const byHash = new Map();

      for (const item of remembered) {
        byHash.set(item.transactionHash, item);
      }

      for (const item of indexed) {
        const local = byHash.get(item.transactionHash);
        byHash.set(item.transactionHash, {
          ...local,
          ...item,
          ...(local?.lastCheckedAt
            ? {
                actionError: local.actionError,
                lastCheckedAt: local.lastCheckedAt,
                pendingAction: local.pendingAction,
                pendingTransactionHash: local.pendingTransactionHash,
                stage: local.stage,
                trackingError: local.trackingError,
              }
            : {}),
        });
      }

      return [...byHash.values()];
    }),
    modalOpen: vi.fn(),
    page: {
      /** @param {(value: any) => void} run */
      subscribe(run) {
        pageSubscribers.add(run);
        run(pageValue);

        return () => pageSubscribers.delete(run);
      },
    },
    proveWithdrawal: vi.fn(),
    recordWithdrawalSubmission: vi.fn(),
    refreshWithdrawalTransaction: vi.fn(),
    rememberHistoryWithdrawals: vi.fn(() =>
      Promise.resolve(/** @type {any[]} */ ([]))
    ),
    rememberWithdrawalTransaction: vi.fn(),
    resumeDepositTracking: vi.fn(),
    resumeWithdrawalTracking: vi.fn(),
    /**
     * @param {any} value
     */
    setAccount(value) {
      accountValue = value;
      subscribers.forEach((run) => run(value));
    },
    /** @param {any[]} value */
    setDepositItems(value) {
      depositItems = value;
      depositSubscribers.forEach((run) => run(value));
    },
    /** @param {any[]} rows */
    setHistoryRows(rows) {
      historyValue = { rows };
      historySubscribers.forEach((run) => run(historyValue));
    },
    /** @param {string} search The page's query, as `?tx=…` */
    setPageSearch(search) {
      pageValue = pageAt(search);
      pageSubscribers.forEach((run) => run(pageValue));
    },
    /** @param {any} chain */
    setTimes(chain) {
      timesValue = { chain, network: "testnet" };
      timesSubscribers.forEach((run) => run(timesValue));
    },
    /**
     * @param {any[]} value
     */
    setWithdrawalItems(value) {
      withdrawalItems = value;
      activitySubscribers.forEach((run) => run(value));
    },
    trackWithdrawalTransaction: vi.fn(() => Promise.resolve(null)),
    withdrawalActivityStore,
    withdrawalItems: () => withdrawalItems,
  };
});

// A wallet with its profiles: the first is the one shown.
vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { default: mockedWalletStore } =
    await import("$lib/mocks/mockedWalletStore");

  return {
    ...original,
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

vi.mock("$lib/activity", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  activityState: mocks.activityState,
}));

vi.mock("$lib/bridge/bridgeTimes", () => ({ default: mocks.bridgeTimes }));

vi.mock("$lib/web3/walletConnection", () => ({
  account: mocks.account,
  duskEvm: {
    blockExplorers: {
      default: { name: "Blockscout", url: "https://explorer.example.test" },
    },
  },
  modal: { open: mocks.modalOpen },
}));

vi.mock("$app/stores", () => {
  const still = (/** @type {any} */ value) => ({
    /** @param {(value: any) => void} run */
    subscribe(run) {
      run(value);

      return () => {};
    },
  });

  return {
    getStores: () => ({ navigating: still(null), page: mocks.page }),
    navigating: still(null),
    page: mocks.page,
    updated: { check: async () => false, ...still(false) },
  };
});

const tracking = vi.hoisted(() => ({
  followTransfers: vi.fn(async () => {}),
}));

vi.mock("$lib/bridge/routeTracking", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  followTransfers: tracking.followTransfers,
}));

vi.mock("$lib/bridge/depositActivity", () => ({
  depositActivityStore: mocks.depositActivityStore,
  followHistoryDeposits: mocks.followHistoryDeposits,
  hydrateDepositActivity: mocks.hydrateDepositActivity,
  resumeDepositTracking: mocks.resumeDepositTracking,
}));

vi.mock("$lib/bridge/withdrawals", () => ({
  finalizeWithdrawal: mocks.finalizeWithdrawal,
  getWithdrawalFinalizationConfig: () => mocks.finalizationConfig,
  /**
   * @param {unknown} value
   */
  isWithdrawalTxHash(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
  },
  loadDuskTransactionExecution: mocks.loadDuskTransactionExecution,
  loadProveNowClaim: mocks.loadProveNowClaim,
  loadWithdrawalStatus: mocks.loadWithdrawalStatus,
  PREPARED_PROOF_MS: 120_000,
  proveWithdrawal: mocks.proveWithdrawal,
}));

vi.mock("$lib/bridge/withdrawalActivity", () => ({
  historyWithdrawals: mocks.historyWithdrawals,
  hydrateWithdrawalActivity: mocks.hydrateWithdrawalActivity,
  loadWithdrawalActivity: mocks.loadWithdrawalActivity,
  mergeWithdrawalActivity: mocks.mergeWithdrawalActivity,
  recordWithdrawalSubmission: mocks.recordWithdrawalSubmission,
  refreshWithdrawalTransaction: mocks.refreshWithdrawalTransaction,
  rememberHistoryWithdrawals: mocks.rememberHistoryWithdrawals,
  rememberWithdrawalTransaction: mocks.rememberWithdrawalTransaction,
  resumeWithdrawalTracking: mocks.resumeWithdrawalTracking,
  trackWithdrawalTransaction: mocks.trackWithdrawalTransaction,
  withdrawalActivityStore: mocks.withdrawalActivityStore,
  /** @param {string} hash */
  withdrawalExplorerUrl: (hash) => `https://explorer.example.test/tx/${hash}`,
  /** @param {string} stage */
  withdrawalStageLabel(stage) {
    switch (stage) {
      case "finalized":
        return "Done";
      case "proven_waiting":
        return "Waiting period";
      case "ready_to_finalize":
        return "Claim on Dusk";
      case "ready_to_prove":
        return "Prove on Dusk";
      case "waiting_for_output":
        return "Not on Dusk yet";
      default:
        return "Processing";
    }
  },
  /** @param {string} stage */
  withdrawalStageProgress(stage) {
    switch (stage) {
      case "finalized":
        return 5;
      case "proven_waiting":
        return 3;
      case "ready_to_finalize":
        return 4;
      case "ready_to_prove":
        return 2;
      case "waiting_for_output":
        return 1;
      default:
        return 0;
    }
  },
}));

const accountAddress = "0x2222222222222222222222222222222222222222";

/** A claim date, as a withdrawal's status gives it: Mon 2 Nov 2026, 03:20:39 UTC. */
const CLAIM_AT = Date.UTC(2026, 10, 2, 3, 20, 39);

/**
 * @param {string} transactionHash
 * @param {string} [stage]
 */
function activityItem(transactionHash, stage = "submitted") {
  return {
    account: accountAddress,
    amountWei: "100000000000000000",
    blockNumber: "13668",
    chainId: 5678,
    createdAt: 1_000,
    explorerStatus: null,
    l1TransactionHash: null,
    source: "local",
    stage,
    timestamp: "2026-07-14T10:00:00Z",
    transactionHash,
  };
}

/**
 * A deposit as this browser keeps it, on its way to DuskEVM.
 *
 * @param {string} transactionHash
 * @param {Record<string, unknown>} [fields]
 */
function deposit(transactionHash, fields = {}) {
  const now = Date.now();

  return {
    account: accountAddress,
    amountLux: "250000000",
    amountWei: null,
    createdAt: now - 60_000,
    failureLayer: null,
    l1BlockHeight: 4_708_700,
    l1ConfirmedAt: now - 30_000,
    progressedAt: now,
    stage: "l2_pending",
    transactionHash,
    ...fields,
  };
}

function emptyActivity() {
  return Promise.resolve({
    error: null,
    items: [],
    sourceUnavailable: false,
  });
}

describe("EvmTransactions", () => {
  beforeEach(() => {
    mocks.finalizeWithdrawal.mockReset();
    mocks.loadDuskTransactionExecution.mockReset();
    mocks.loadWithdrawalActivity.mockReset();
    mocks.loadWithdrawalStatus.mockReset();
    mocks.modalOpen.mockReset();
    mocks.proveWithdrawal.mockReset();
    mocks.recordWithdrawalSubmission.mockReset();
    mocks.refreshWithdrawalTransaction.mockReset();
    mocks.rememberWithdrawalTransaction.mockReset();
    mocks.resumeWithdrawalTracking.mockReset();
    mocks.trackWithdrawalTransaction.mockClear();
    mocks.historyWithdrawals.mockReset();
    mocks.historyWithdrawals.mockReturnValue([]);
    mocks.followHistoryDeposits.mockReset();
    mocks.followHistoryDeposits.mockReturnValue(new Set());
    mocks.rememberHistoryWithdrawals.mockReset();
    mocks.rememberHistoryWithdrawals.mockResolvedValue([]);
    mocks.loadProveNowClaim.mockReset();
    mocks.loadProveNowClaim.mockResolvedValue(null);
    mocks.setHistoryRows([]);
    mocks.setTimes(null);
    mocks.finalizationConfig = mocks.configuredFinalizationConfig();
    mocks.setAccount({ address: undefined, isConnected: false });
    mocks.setWithdrawalItems([]);
    mocks.setDepositItems([]);
    mocks.setPageSearch("");
    // A testnet node, with DuskEVM.
    setNodeNetwork(networks.testnet);
    mocks.resumeDepositTracking.mockReset();
    mocks.loadWithdrawalActivity.mockImplementation(emptyActivity);
    mocks.loadDuskTransactionExecution.mockResolvedValue(null);
    mocks.rememberWithdrawalTransaction.mockImplementation((hash, options) => {
      const existing = mocks
        .withdrawalItems()
        .find((item) => item.transactionHash === hash);
      const base = existing ?? activityItem(hash);
      const item = {
        ...base,
        account:
          options && Object.hasOwn(options, "account")
            ? options.account
            : base.account,
        amountWei: options?.amountWei ?? base.amountWei,
      };
      mocks.setWithdrawalItems([
        item,
        ...mocks
          .withdrawalItems()
          .filter((candidate) => candidate.transactionHash !== hash),
      ]);
      return item;
    });
    mocks.refreshWithdrawalTransaction.mockImplementation(async (hash) => {
      const status = await mocks.loadWithdrawalStatus(hash);
      const existing =
        mocks.withdrawalItems().find((item) => item.transactionHash === hash) ??
        activityItem(hash);
      const item = {
        ...existing,
        ...status,
        blockNumber: status.blockNumber?.toString() ?? existing.blockNumber,
        lastCheckedAt: Date.now(),
        pendingAction: null,
        pendingTransactionHash: null,
        trackingError: null,
      };
      mocks.setWithdrawalItems([
        item,
        ...mocks
          .withdrawalItems()
          .filter((candidate) => candidate.transactionHash !== hash),
      ]);
      return item;
    });
    mocks.recordWithdrawalSubmission.mockImplementation((hash, submission) => {
      const existing = mocks
        .withdrawalItems()
        .find((item) => item.transactionHash === hash);
      const item = {
        ...existing,
        actionError: null,
        pendingAction: submission.action,
        pendingTransactionHash: submission.hash,
        stage:
          submission.action === "prove"
            ? "prove_submitted"
            : "finalize_submitted",
      };
      mocks.setWithdrawalItems([
        item,
        ...mocks
          .withdrawalItems()
          .filter((candidate) => candidate.transactionHash !== hash),
      ]);
      return item;
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("lists migrations into Dusk and transfers out to BNB Smart Chain on mainnet, without DuskEVM's parts", async () => {
    // Mainnet: no DuskEVM, so nothing of it is configured.
    setNodeNetwork(networks.mainnet);
    mocks.finalizationConfig = {
      ...mocks.configuredFinalizationConfig(),
      configured: false,
      disputeGameFactoryContractId: undefined,
      missing: ["VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID"],
      optimismPortalContractId: undefined,
    };

    const [bsc] = networks.mainnet.routes.migrations;
    const [out] = networks.mainnet.routes.services;
    const paidAt = Date.now() - 3_600_000;
    const sentAt = Date.now() - 600_000;

    const { container, findByRole, getByRole, queryByLabelText, queryByText } =
      render(EvmTransactions, { target: document.body });

    // The history comes after the page opened.
    expect(tracking.followTransfers).not.toHaveBeenCalled();
    mocks.setHistoryRows(
      rowsOf([
        {
          amount: "5000000000",
          blockHeight: 4_700_000,
          counterparty: bsc.payoutAccount,
          direction: "in",
          hash: "b1".repeat(32),
          memo: `0x${"a6".repeat(32)}`,
          status: "executed",
          timestamp: paidAt,
        },
        {
          amount: "200001000000000",
          counterparty: out.account,
          hash: "d1".repeat(32),
          memo: accountAddress,
          status: "executed",
          timestamp: sentAt,
        },
      ])
    );
    const paid = await findByRole("button", {
      name: `BNB Smart Chain to Dusk Paid ${claimDay(paidAt, "en")} 5 DUSK`,
    });
    const sent = getByRole("button", {
      name: `Dusk to BNB Smart Chain Sent ${claimDay(sentAt, "en")} · takes ~10 hours 200,001 DUSK Pending`,
    });

    expect(paid.closest("section")).toHaveAccessibleName("Completed");
    expect(sent.closest("section")).toHaveAccessibleName("In progress");
    // No DuskEVM on mainnet: nothing to connect for it, nor to look up.
    expect(queryByText(/Connect DuskEVM wallet/)).toBeNull();
    expect(queryByLabelText("Find by transaction hash")).toBeNull();
    expect(container).toHaveTextContent(
      "Transfers between Dusk and other chains."
    );

    // Followed as soon as the history gives the one under way: the one
    // paid needs no read.
    await vi.waitFor(() =>
      expect(tracking.followTransfers).toHaveBeenCalledWith(
        [
          expect.objectContaining({ kind: "migration", stage: "paid" }),
          expect.objectContaining({ hash: "d1".repeat(32), stage: "sent" }),
        ],
        {}
      )
    );

    await fireEvent.click(paid);

    // On mainnet's own Dusk explorer.
    expect(
      getByRole("link", { name: "View dusk payout hash in Dusk explorer" })
    ).toHaveAttribute(
      "href",
      `https://apps.dusk.network/explorer/transactions/transaction?id=${"b1".repeat(32)}`
    );
  });

  it("opens the migration its link names, one this browser sent to the profile shown", async () => {
    const { currentProfile } = get(walletStore);
    /** @param {string} hash @param {string} recipient */
    const sent = (hash, recipient) => ({
      amountLux: "2500000000",
      createdAt: Date.now(),
      hash,
      recipient,
      routeId: "bsc-to-dusk",
      sender: accountAddress,
    });

    setNodeNetwork(networks.mainnet);
    localStorage.setItem(
      "web-wallet-migrations",
      JSON.stringify([
        sent(`0x${"bb".repeat(32)}`, String(currentProfile?.account)),
        // Sent to another wallet's account: not this profile's.
        sent(`0x${"cc".repeat(32)}`, "an-earlier-wallets-account"),
      ])
    );
    mocks.setPageSearch(`?tx=0x${"bb".repeat(32)}`);

    const { findByRole, getAllByRole } = render(EvmTransactions, {
      target: document.body,
    });

    expect(
      await findByRole("button", { name: /^BNB Smart Chain to Dusk Sent/ })
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      getAllByRole("button", { name: /^BNB Smart Chain to Dusk/ })
    ).toHaveLength(1);
    // Not looked up as a withdrawal.
    expect(mocks.loadWithdrawalStatus).not.toHaveBeenCalled();
    localStorage.clear();
    (await import("$lib/bridge/migrationActivity")).hydrateMigrations();
  });

  it("reads nothing of DuskEVM, nor says it can't, on a network without it as an EVM wallet connects", async () => {
    setNodeNetwork(networks.mainnet);
    mocks.finalizationConfig = {
      ...mocks.configuredFinalizationConfig(),
      configured: false,
      disputeGameFactoryContractId: undefined,
      missing: ["VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID"],
      optimismPortalContractId: undefined,
    };
    // What DuskEVM's reads say where there's no DuskEVM.
    mocks.loadWithdrawalActivity.mockResolvedValue({
      error: "The DuskEVM bridge isn't configured.",
      items: [],
    });
    mocks.rememberHistoryWithdrawals.mockRejectedValue(
      new Error("The DuskEVM bridge isn't configured.")
    );

    const { queryByText } = render(EvmTransactions, {
      target: document.body,
    });

    // Connected for a migration.
    mocks.setAccount({ address: accountAddress, isConnected: true });
    await tick();
    await tick();

    expect(mocks.loadWithdrawalActivity).not.toHaveBeenCalled();
    expect(mocks.rememberHistoryWithdrawals).not.toHaveBeenCalled();
    expect(mocks.resumeWithdrawalTracking).not.toHaveBeenCalled();
    expect(mocks.resumeDepositTracking).not.toHaveBeenCalled();
    expect(queryByText(/DuskEVM's explorer can't be read/)).toBeNull();
  });

  it("reads nothing again while nothing is under way", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    try {
      mocks.setAccount({ address: accountAddress, isConnected: true });
      render(EvmTransactions, { target: document.body });
      await vi.waitFor(() =>
        expect(mocks.loadWithdrawalActivity).toHaveBeenCalledTimes(1)
      );

      vi.advanceTimersByTime(60_000);

      expect(mocks.loadWithdrawalActivity).toHaveBeenCalledTimes(1);

      // A withdrawal on its way: read again, every 30 seconds.
      mocks.setWithdrawalItems([activityItem(`0x${"5d".repeat(32)}`)]);
      await tick();
      vi.advanceTimersByTime(30_000);

      expect(mocks.loadWithdrawalActivity).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps activity and manual lookup available without an EVM wallet", async () => {
    mocks.loadWithdrawalActivity.mockImplementation(emptyActivity);

    const { findByText, getByLabelText, getByRole, getByText } = render(
      EvmTransactions,
      {
        target: document.body,
      }
    );

    expect(getByLabelText("Find by transaction hash")).toBeInTheDocument();
    expect(
      await findByText(
        "Connect DuskEVM wallet to list its deposits and other withdrawals."
      )
    ).toBeInTheDocument();
    await fireEvent.click(getByRole("button", { name: /^connect$/i }));
    expect(mocks.modalOpen).toHaveBeenCalledOnce();
    // The bridge's card, on its Activity tab, with the way Home.
    expect(getByRole("link", { name: "Bridge" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard/bridge"
    );
    expect(getByRole("link", { name: "Activity" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard"
    );
    expect(getByText("No transfers yet.")).toBeInTheDocument();
  });

  it("lists the deposits kept here with the withdrawals, each in its group, and opens one row at a time", async () => {
    const depositHash = "ab".repeat(32);
    const withdrawalHash = `0x${"5c".repeat(32)}`;
    const now = Date.now();

    mocks.setAccount({ address: accountAddress, isConnected: true });
    mocks.setDepositItems([
      deposit(depositHash, { account: null, createdAt: now - 60_000 }),
      // Another DuskEVM account's: not this one's to see.
      deposit("cd".repeat(32), {
        account: `0x${"99".repeat(20)}`,
        amountLux: "500000000",
      }),
    ]);
    mocks.setWithdrawalItems([
      { ...activityItem(withdrawalHash, "ready_to_finalize"), account: null },
    ]);
    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13668n,
      stage: "ready_to_finalize",
      transactionHash: withdrawalHash,
      withdrawalHash: `0x${"e9".repeat(32)}`,
    });

    const {
      findByRole,
      getByLabelText,
      getByRole,
      getByText,
      queryByRole,
      queryByText,
    } = render(EvmTransactions, { target: document.body });
    const depositButton = await findByRole("button", {
      name: new RegExp(
        `^Dusk to DuskEVM Sent ${claimDay(now - 60_000, "en")}.* 0\\.25 DUSK Pending$`
      ),
    });
    const withdrawalButton = getByRole("button", {
      name: "DuskEVM to Dusk Ready to claim on Dusk 0.1 DUSK",
    });

    expect(withdrawalButton.closest("section")).toHaveAccessibleName(
      "Needs you"
    );
    expect(depositButton.closest("section")).toHaveAccessibleName(
      "In progress"
    );
    expect(queryByRole("button", { name: /0\.5 DUSK/ })).toBeNull();
    expect(mocks.resumeDepositTracking).toHaveBeenCalledWith(accountAddress);

    // A deposit opens to its steps.
    await fireEvent.click(depositButton);

    expect(depositButton).toHaveAttribute("aria-expanded", "true");
    expect(getByText("DuskDS transaction")).toBeInTheDocument();
    // Its row says the amount and the state: the steps don't again.
    expect(queryByRole("heading", { name: "0.25 DUSK" })).toBeNull();

    // Opening a withdrawal closes it.
    await fireEvent.click(withdrawalButton);

    await waitFor(() =>
      expect(withdrawalButton).toHaveAttribute("aria-expanded", "true")
    );
    expect(depositButton).toHaveAttribute("aria-expanded", "false");
    expect(queryByText("DuskDS transaction")).toBeNull();

    // And the other way around.
    await fireEvent.click(depositButton);

    await waitFor(() =>
      expect(depositButton).toHaveAttribute("aria-expanded", "true")
    );
    expect(withdrawalButton).toHaveAttribute("aria-expanded", "false");

    // A withdrawal found by its hash opens in the deposit's place, which
    // stays closed once that withdrawal goes: it's the account's, and
    // another account connects.
    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: withdrawalHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await waitFor(() =>
      expect(withdrawalButton).toHaveAttribute("aria-expanded", "true")
    );
    expect(depositButton).toHaveAttribute("aria-expanded", "false");

    mocks.setAccount({ address: `0x${"33".repeat(20)}`, isConnected: true });
    await tick();

    expect(withdrawalButton).not.toBeInTheDocument();
    expect(queryByRole("button", { expanded: true })).toBeNull();
    expect(depositButton).toHaveAttribute("aria-expanded", "false");
  });

  it("lists this wallet's own deposits from its history with no EVM wallet connected, saying when they arrived and where", async () => {
    const own = "ef".repeat(32);
    const paid = `0x${"29".repeat(32)}`;
    const arrived = Date.now() - 30_000;
    const rows = [
      {
        bridge: {
          amount: "250000000",
          kind: "deposit",
          to: "0xAB84EDFFD745af9420AC74FEC73121FBEE9FC86F",
        },
        hash: own,
      },
    ];

    mocks.followHistoryDeposits.mockReturnValue(new Set([own]));
    mocks.setHistoryRows(rows);
    mocks.setDepositItems([
      deposit(own, {
        account: "0xab84edffd745af9420ac74fec73121fbee9fc86f",
        arrivedAt: arrived,
        l2TransactionHash: paid,
        stage: "completed",
      }),
      // Another wallet's, to a DuskEVM account that isn't connected.
      deposit("cd".repeat(32), {
        account: `0x${"99".repeat(20)}`,
        amountLux: "500000000",
      }),
    ]);

    const { findByRole, getByRole, getByText, queryByRole } = render(
      EvmTransactions,
      { target: document.body }
    );
    const row = await findByRole("button", {
      name: `Dusk to DuskEVM Arrived ${claimDay(arrived, "en")} · to 0xAB84…C86F 0.25 DUSK`,
    });

    expect(mocks.followHistoryDeposits).toHaveBeenCalledWith(rows);
    expect(row.closest("section")).toHaveAccessibleName("Completed");
    expect(queryByRole("button", { name: /0\.5 DUSK/ })).toBeNull();

    // Its steps link the DuskEVM transaction that paid it.
    await fireEvent.click(row);

    expect(getByText("Arrived")).toBeInTheDocument();
    expect(
      getByRole("link", {
        name: "View duskevm transaction hash in Blockscout",
      })
    ).toHaveAttribute("href", `https://explorer.example.test/tx/${paid}`);
  });

  it("puts a withdrawal the EVM wallet sent to someone else's Dusk account in a group of its own, saying whom it pays, with its Prove offered quietly", async () => {
    const theirs = `0x${"67".repeat(32)}`;
    const mine = `0x${"68".repeat(32)}`;
    const own = String(get(walletStore).currentProfile?.account);
    const other =
      "213qXNJXsQEGigeKJ8jFxuaPb1UV2BiGNykjS3cqRULiaBjQQcGQyEknV7WAhNF5u9hhhFoJcLxbuMWuWhCq3b9jCHDTpvGZaV5HcUU8Z5c4oHbdJ7TQ1NWQJNghYV5JJ9Y";

    mocks.setAccount({ address: accountAddress, isConnected: true });
    mocks.setWithdrawalItems([
      { ...activityItem(theirs, "ready_to_prove"), recipient: other },
      { ...activityItem(mine, "ready_to_prove"), recipient: own },
    ]);
    mocks.loadWithdrawalStatus.mockImplementation(async (hash) => ({
      blockNumber: 13668n,
      stage: "ready_to_prove",
      transactionHash: hash,
    }));

    const { findByRole, getAllByRole, getByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const row = await findByRole("button", {
      name: "DuskEVM to Dusk Pays 213qXN…V5JJ9Y · ready to prove on Dusk 0.1 DUSK",
    });

    expect(row.closest("section")).toHaveAccessibleName("Sent to someone else");
    expect(
      getByRole("button", {
        name: "DuskEVM to Dusk Ready to prove on Dusk 0.1 DUSK",
      }).closest("section")
    ).toHaveAccessibleName("Needs you");

    // What needs you comes first.
    const [loud, quiet] = getAllByRole("button", {
      name: "Prove 0.1 DUSK from DuskEVM",
    });

    expect(quiet).toHaveClass("dusk-button--variant--secondary");
    expect(loud).toHaveClass("dusk-button--variant--primary");

    // Opened, its own step is quiet too.
    await fireEvent.click(quiet);

    expect(await findByRole("button", { name: "Prove on Dusk" })).toHaveClass(
      "dusk-button--variant--secondary"
    );
  });

  it("leaves a withdrawal to someone else that this wallet proved where its claim needs it, with its Claim as ever, still saying whom it pays", async () => {
    const theirs = `0x${"69".repeat(32)}`;
    const withdrawalHash = `0x${"a3".repeat(32)}`;
    const other =
      "213qXNJXsQEGigeKJ8jFxuaPb1UV2BiGNykjS3cqRULiaBjQQcGQyEknV7WAhNF5u9hhhFoJcLxbuMWuWhCq3b9jCHDTpvGZaV5HcUU8Z5c4oHbdJ7TQ1NWQJNghYV5JJ9Y";

    mocks.setAccount({ address: accountAddress, isConnected: true });
    // Its reads, which are this wallet's, say it's proved and ready to claim.
    mocks.setWithdrawalItems([
      {
        ...activityItem(theirs, "ready_to_finalize"),
        recipient: other,
        withdrawalHash,
      },
    ]);
    mocks.loadWithdrawalStatus.mockImplementation(async (hash) => ({
      blockNumber: 13668n,
      stage: "ready_to_finalize",
      transactionHash: hash,
      withdrawalHash,
    }));

    const { findByRole, getByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const row = await findByRole("button", {
      name: "DuskEVM to Dusk Pays 213qXN…V5JJ9Y · ready to claim on Dusk 0.1 DUSK",
    });

    expect(row.closest("section")).toHaveAccessibleName("Needs you");
    expect(
      getByRole("button", { name: "Claim 0.1 DUSK from DuskEVM" })
    ).toHaveClass("dusk-button--variant--primary");
  });

  it("opens the deposit its link names, without checking it as a withdrawal", async () => {
    const depositHash = "ab".repeat(32);

    mocks.setDepositItems([
      deposit(depositHash, { account: null, stage: "completed" }),
    ]);
    mocks.setPageSearch(`?tx=${depositHash}`);

    const { findByRole, getByText } = render(EvmTransactions, {
      target: document.body,
    });

    expect(
      await findByRole("button", {
        name: /^Dusk to DuskEVM Arrived on DuskEVM 0\.25 DUSK$/,
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(getByText("DuskDS transaction")).toBeInTheDocument();
    expect(mocks.loadWithdrawalStatus).not.toHaveBeenCalled();
    expect(mocks.rememberWithdrawalTransaction).not.toHaveBeenCalled();
  });

  it("opens the deposit its link names once its account connects, never checking it as a withdrawal", async () => {
    const depositHash = "cd".repeat(32);

    mocks.setDepositItems([deposit(depositHash, { stage: "completed" })]);
    mocks.setPageSearch(`?tx=${depositHash}`);

    const { findByRole, getByLabelText, queryByRole } = render(
      EvmTransactions,
      { target: document.body }
    );
    const input = getByLabelText("Find by transaction hash");

    // Its account isn't connected: the deposit isn't listed yet. A Dusk
    // hash waits for what it names, a deposit or a transfer out.
    await tick();

    expect(queryByRole("alert")).toBeNull();

    mocks.setAccount({ address: accountAddress, isConnected: true });

    expect(
      await findByRole("button", {
        name: /^Dusk to DuskEVM Arrived on DuskEVM · to 0x\w{4}…\w{4} 0\.25 DUSK$/,
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveValue("");
    expect(mocks.loadWithdrawalStatus).not.toHaveBeenCalled();
  });

  it("leaves the linked deposit closed when a hash was checked before its account connects", async () => {
    const depositHash = "cd".repeat(32);

    mocks.setDepositItems([deposit(depositHash, { stage: "completed" })]);
    mocks.setPageSearch(`?tx=${depositHash}`);

    const { findByRole, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const input = getByLabelText("Find by transaction hash");

    await fireEvent.input(input, { target: { value: "0x1234" } });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    mocks.setAccount({ address: accountAddress, isConnected: true });

    expect(
      await findByRole("button", {
        name: /^Dusk to DuskEVM Arrived on DuskEVM · to 0x\w{4}…\w{4} 0\.25 DUSK$/,
      })
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("shows inline validation for an invalid transaction hash", async () => {
    const { findByRole, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const input = getByLabelText("Find by transaction hash");

    await fireEvent.input(input, { target: { value: "0x1234" } });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(await findByRole("alert")).toHaveTextContent(
      "Enter a 0x-prefixed 32-byte transaction hash."
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(mocks.loadWithdrawalStatus).not.toHaveBeenCalled();
  });

  it("shows missing finalization config and disables status checks", async () => {
    mocks.finalizationConfig = {
      configured: false,
      disputeGameFactoryContractId: undefined,
      disputeGameFactoryDataDriverUrl: "/dispute_game_factory_dd_opt.wasm",
      l2RpcUrl: "https://rpc.devnet.duskevm.dusk.network",
      missing: [
        "VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID",
        "VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID",
      ],
      optimismPortalContractId: undefined,
      optimismPortalDataDriverUrl: "/optimism_portal_dd_opt.wasm",
    };

    const { getByRole, getByText } = render(EvmTransactions, {
      target: document.body,
    });

    expect(getByText("Finalization not configured")).toBeInTheDocument();
    expect(
      getByText(
        "Missing VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID, VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID."
      )
    ).toBeInTheDocument();
    expect(getByRole("button", { name: /^check$/i })).toBeDisabled();
  });

  it("loads indexed activity for the connected EVM account", async () => {
    const txHash = `0x${"57".repeat(32)}`;

    mocks.setAccount({ address: accountAddress, isConnected: true });
    mocks.loadWithdrawalActivity.mockResolvedValue({
      error: null,
      items: [activityItem(txHash, "waiting_for_output")],
      sourceUnavailable: false,
    });
    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13668n,
      stage: "waiting_for_output",
      transactionHash: txHash,
      withdrawalHash: `0x${"e7".repeat(32)}`,
    });

    const { findByRole, queryByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const item = await findByRole("button", {
      name: /Not on Dusk yet.*0\.1 DUSK/i,
    });

    expect(item).toHaveAttribute("aria-expanded", "false");
    await fireEvent.click(item);

    expect(mocks.loadWithdrawalActivity).toHaveBeenCalledWith(accountAddress);
    expect(mocks.loadWithdrawalStatus).toHaveBeenCalledWith(txHash);
    expect(
      queryByRole("button", { name: /refresh status/i })
    ).not.toBeInTheDocument();
    expect(item).toHaveAttribute("aria-expanded", "true");

    await fireEvent.click(item);

    await waitFor(() => {
      expect(item).toHaveAttribute("aria-expanded", "false");
    });
  });

  it("names a withdrawal by its route and amount, says what it needs once, and when it was sent in its steps", async () => {
    const txHash = `0x${"5a".repeat(32)}`;
    const sentAt = "2026-09-25T11:51:09.000Z";

    mocks.setAccount({ address: accountAddress, isConnected: true });
    mocks.loadWithdrawalActivity.mockResolvedValue({
      error: null,
      items: [
        {
          ...activityItem(txHash, "ready_to_prove"),
          amountWei: "10000000000000000000",
          blockNumber: "2580123",
          createdAt: Date.parse("2026-10-26T01:10:00Z"),
          sentAt,
          timestamp: "2026-10-26T01:10:00.000Z",
        },
      ],
      sourceUnavailable: false,
    });
    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 2580123n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"ea".repeat(32)}`,
    });

    const { container, findByRole, getAllByText, getByRole, queryByText } =
      render(EvmTransactions, { target: document.body });
    const item = await findByRole("button", {
      name: "DuskEVM to Dusk Ready to prove on Dusk 10 DUSK",
    });

    // It needs its proof: under Needs you, with Prove beside it.
    expect(item.closest("section")).toHaveAccessibleName("Needs you");
    expect(
      getByRole("button", { name: "Prove 10 DUSK from DuskEVM" })
    ).toBeInTheDocument();

    await fireEvent.click(item);

    expect(
      Array.from(container.querySelectorAll(".withdrawal-details dt"), (term) =>
        term.textContent?.trim()
      )
    ).toStrictEqual([
      "Sent",
      "DuskEVM block",
      "DuskEVM transaction",
      "Withdrawal hash",
    ]);
    expect(container.querySelector(".withdrawal-details dd")).toHaveTextContent(
      formatTimestamp(sentAt)
    );
    expect(getAllByText("Ready to prove on Dusk")).toHaveLength(1);
    expect(getByRole("button", { name: "Prove on Dusk" })).toBeInTheDocument();
    expect(
      getByRole("button", { name: "Copy duskevm transaction hash" })
    ).toBeInTheDocument();
    expect(queryByText(/Initiated|L2 /)).toBeNull();
  });

  it("links a withdrawal's two sides: its DuskEVM transaction, and its proof on Dusk as the history has it", async () => {
    const txHash = `0x${"5b".repeat(32)}`;
    const withdrawalHash = `0x${"eb".repeat(32)}`;
    const proof = "b7".repeat(32);

    mocks.setAccount({ address: accountAddress, isConnected: true });
    mocks.setHistoryRows(
      rowsOf([
        {
          bridge: { hash: withdrawalHash, kind: "prove", withdrawal: "01" },
          hash: proof,
          status: "executed",
          timestamp: Date.now() - 3_600_000,
        },
      ])
    );
    mocks.loadWithdrawalActivity.mockResolvedValue({
      error: null,
      items: [{ ...activityItem(txHash, "proven_waiting"), withdrawalHash }],
      sourceUnavailable: false,
    });
    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 2580123n,
      stage: "proven_waiting",
      transactionHash: txHash,
      withdrawalHash,
    });

    const { findByRole, getByRole } = render(EvmTransactions, {
      target: document.body,
    });

    await fireEvent.click(
      await findByRole("button", { name: /^DuskEVM to Dusk / })
    );

    expect(
      getByRole("link", { name: "View duskevm transaction hash in Blockscout" })
    ).toHaveAttribute("href", `https://explorer.example.test/tx/${txHash}`);
    expect(
      await findByRole("link", {
        name: "View proof on dusk hash in Dusk explorer",
      })
    ).toHaveAttribute(
      "href",
      `https://apps.testnet.dusk.network/explorer/transactions/transaction?id=${proof}`
    );
  });

  it("shows the complete journey and prove action when ready", async () => {
    const txHash = `0x${"58".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13669n,
      proofSubmitter: "0xeb9ea22334e679cdbc669cf9ad2d713b559708b1",
      provenAt: 0n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"e8".repeat(32)}`,
    });

    const { findByRole, getAllByText, getByLabelText, getByRole, getByText } =
      render(EvmTransactions, { target: document.body });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(
      await findByRole("button", { name: /^prove on dusk$/i })
    ).toBeInTheDocument();
    for (const label of [
      "Sent",
      "Reported to Dusk",
      "Proved",
      "Waiting period",
      "Claimed",
    ]) {
      expect(getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(
      getByText("Step 2 of 3. Fee from your public account.")
    ).toBeInTheDocument();
  });

  it("does not show the prove action before an output is available", async () => {
    const txHash = `0x${"59".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13670n,
      stage: "waiting_for_output",
      statusMessage:
        "No finalized output proposal covering this withdrawal is ready yet.",
      transactionHash: txHash,
      withdrawalHash: `0x${"e9".repeat(32)}`,
    });

    const { findByText, getByLabelText, getByRole, queryByRole, queryByText } =
      render(EvmTransactions, { target: document.body });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(await findByText("Usually within an hour.")).toBeInTheDocument();
    expect(
      queryByText(
        "No finalized output proposal covering this withdrawal is ready yet."
      )
    ).not.toBeInTheDocument();
    expect(
      queryByRole("button", { name: /^prove on dusk$/i })
    ).not.toBeInTheDocument();
  });

  it("submits proof for the checked hash after the lookup input is edited", async () => {
    const checkedHash = `0x${"60".repeat(32)}`;
    const editedHash = `0x${"61".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13671n,
      stage: "ready_to_prove",
      transactionHash: checkedHash,
      withdrawalHash: `0x${"ea".repeat(32)}`,
    });
    mocks.proveWithdrawal.mockResolvedValue("proof-transaction-hash");

    const { findByRole, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const input = getByLabelText("Find by transaction hash");

    await fireEvent.input(input, { target: { value: checkedHash } });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await findByRole("button", { name: /^prove on dusk$/i });
    await fireEvent.input(input, { target: { value: editedHash } });
    await fireEvent.click(getByRole("button", { name: /^prove on dusk$/i }));

    await waitFor(() => {
      expect(mocks.proveWithdrawal).toHaveBeenCalledWith(checkedHash);
    });
  });

  it("does not offer a duplicate proof while the submitted proof is pending", async () => {
    const txHash = `0x${"64".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13673n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"ec".repeat(32)}`,
    });
    mocks.proveWithdrawal.mockResolvedValue("65".repeat(32));

    const {
      findAllByText,
      findByRole,
      getByLabelText,
      getByRole,
      queryByRole,
    } = render(EvmTransactions, { target: document.body });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await fireEvent.click(
      await findByRole("button", { name: /^prove on dusk$/i })
    );
    expect(
      (await findAllByText("Proof sent, waiting for Dusk")).length
    ).toBeGreaterThan(0);
    expect(mocks.recordWithdrawalSubmission).toHaveBeenCalledWith(txHash, {
      action: "prove",
      hash: "65".repeat(32),
    });
    expect(
      queryByRole("button", { name: /^prove on dusk$/i })
    ).not.toBeInTheDocument();
    expect(
      queryByRole("button", { name: /refresh status/i })
    ).not.toBeInTheDocument();
    expect(
      (await findAllByText("Proof sent, waiting for Dusk")).length
    ).toBeGreaterThan(0);
  });

  it("re-enables proof with a short line when the submitted transaction fails", async () => {
    const txHash = `0x${"66".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13674n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"ed".repeat(32)}`,
    });
    mocks.proveWithdrawal.mockResolvedValue("67".repeat(32));
    const {
      findAllByText,
      findByRole,
      findByText,
      getByLabelText,
      getByRole,
      queryByText,
    } = render(EvmTransactions, { target: document.body });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await fireEvent.click(
      await findByRole("button", { name: /^prove on dusk$/i })
    );
    await findAllByText("Proof sent, waiting for Dusk");

    const pending = mocks
      .withdrawalItems()
      .find((item) => item.transactionHash === txHash);
    mocks.setWithdrawalItems([
      {
        ...pending,
        actionError: "Proof transaction failed: contract execution failed",
        pendingAction: null,
        pendingTransactionHash: null,
        stage: "ready_to_prove",
      },
    ]);

    expect(
      await findByRole("button", { name: /^prove on dusk$/i })
    ).toBeInTheDocument();
    expect(
      await findByText("The proof wasn't sent. Try again.")
    ).toBeInTheDocument();
    expect(queryByText(/contract execution failed/i)).not.toBeInTheDocument();
  });

  it.each([
    {
      action: "prove",
      button: /^prove on dusk$/i,
      line: "The proof wasn't sent. Try again.",
      stage: "ready_to_prove",
    },
    {
      action: "finalize",
      button: /^claim on dusk$/i,
      line: "The claim wasn't sent. Try again.",
      stage: "ready_to_finalize",
    },
  ])(
    "keeps the $action action for a retry when it isn't sent, and logs why",
    async ({ action, button, line, stage }) => {
      const txHash = `0x${"68".repeat(32)}`;
      const error = new Error("User rejected the request.");
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      mocks.loadWithdrawalStatus.mockResolvedValue({
        blockNumber: 13675n,
        stage,
        transactionHash: txHash,
        withdrawalHash: `0x${"ee".repeat(32)}`,
      });
      (action === "prove"
        ? mocks.proveWithdrawal
        : mocks.finalizeWithdrawal
      ).mockRejectedValue(error);

      const { findByRole, findByText, getByLabelText, getByRole, queryByText } =
        render(EvmTransactions, { target: document.body });

      await fireEvent.input(getByLabelText("Find by transaction hash"), {
        target: { value: txHash },
      });
      await fireEvent.click(getByRole("button", { name: /^check$/i }));
      await fireEvent.click(await findByRole("button", { name: button }));

      // The banner is that one line.
      expect(
        (await findByText(line)).closest(".banner")?.textContent?.trim()
      ).toBe(line);
      expect(queryByText(error.message)).not.toBeInTheDocument();
      expect(getByRole("button", { name: button })).toBeEnabled();
      expect(consoleError).toHaveBeenCalledWith(
        `Withdrawal ${action} failed`,
        error
      );
      expect(mocks.recordWithdrawalSubmission).not.toHaveBeenCalled();

      consoleError.mockRestore();
    }
  );

  it("keeps the gas refusal's own line on the card", async () => {
    const txHash = `0x${"6a".repeat(32)}`;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13675n,
      stage: "ready_to_finalize",
      transactionHash: txHash,
      withdrawalHash: `0x${"ee".repeat(32)}`,
    });
    mocks.finalizeWithdrawal.mockRejectedValue(
      new Error(WITHDRAWAL_GAS_REFUSAL)
    );

    const { findByRole, findByText, getByLabelText, getByRole, queryByText } =
      render(EvmTransactions, { target: document.body });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await fireEvent.click(
      await findByRole("button", { name: /^claim on dusk$/i })
    );

    expect(
      (await findByText(WITHDRAWAL_GAS_REFUSAL))
        .closest(".banner")
        ?.textContent?.trim()
    ).toBe(WITHDRAWAL_GAS_REFUSAL);
    expect(
      queryByText("The claim wasn't sent. Try again.")
    ).not.toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("says the DUSK is still on DuskEVM when the withdrawal failed there", async () => {
    const txHash = `0x${"69".repeat(32)}`;

    mocks.setAccount({ address: accountAddress, isConnected: true });
    mocks.setWithdrawalItems([
      {
        ...activityItem(txHash, "failed"),
        actionError: "Withdrawal transaction failed on DuskEVM.",
      },
    ]);
    mocks.loadWithdrawalStatus.mockRejectedValue(
      new Error("Withdrawal transaction failed on DuskEVM.")
    );
    mocks.refreshWithdrawalTransaction.mockImplementation(async (hash) =>
      mocks.withdrawalItems().find((item) => item.transactionHash === hash)
    );

    const { findByRole, findByText, queryByText } = render(EvmTransactions, {
      target: document.body,
    });

    await fireEvent.click(
      await findByRole("button", { name: /0\.1 DUSK.*Failed/i })
    );

    expect(
      await findByText("Your DUSK is still on DuskEVM.")
    ).toBeInTheDocument();
    expect(
      queryByText("Withdrawal transaction failed on DuskEVM.")
    ).not.toBeInTheDocument();
  });

  it("updates the expanded withdrawal from background tracking", async () => {
    const selectedHash = `0x${"62".repeat(32)}`;
    const editedHash = `0x${"63".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13672n,
      stage: "waiting_for_output",
      transactionHash: selectedHash,
      withdrawalHash: `0x${"eb".repeat(32)}`,
    });

    const { findByRole, getByLabelText, getByRole, getByText } = render(
      EvmTransactions,
      { target: document.body }
    );
    const input = getByLabelText("Find by transaction hash");

    await fireEvent.input(input, { target: { value: selectedHash } });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await findByRole("button", {
      name: /Not on Dusk yet.*0\.1 DUSK/i,
    });
    await fireEvent.input(input, { target: { value: editedHash } });

    const selected = mocks
      .withdrawalItems()
      .find((item) => item.transactionHash === selectedHash);
    mocks.setWithdrawalItems([
      {
        ...selected,
        proofSubmitter: "0xeb9ea22334e679cdbc669cf9ad2d713b559708b1",
        readyAt: String(CLAIM_AT / 1_000),
        readyAtExact: true,
        stage: "proven_waiting",
      },
    ]);

    expect(
      await findByRole("button", {
        name: new RegExp(`Claim from ${claimDay(CLAIM_AT, "en")} 0\\.1 DUSK`),
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      getByText(`Claim from ${claimDay(CLAIM_AT, "en")}`, {
        selector: ".bridge-timeline *",
      })
    ).toBeInTheDocument();
    expect(mocks.loadWithdrawalStatus).not.toHaveBeenCalledWith(editedHash);
  });

  it("lists the withdrawals the history knows without an EVM wallet, with their claim date and a Claim button", async () => {
    const waitingHash = `0x${"64".repeat(32)}`;
    const readyHash = `0x${"65".repeat(32)}`;
    const otherHash = `0x${"66".repeat(32)}`;
    const sender = "0xc11d5aab4234e255e214ac6e8c0ad61fa0836473";

    mocks.historyWithdrawals.mockReturnValue([
      { hash: `0x${"a1".repeat(32)}`, nonce: 41n },
      { hash: `0x${"a2".repeat(32)}`, nonce: 42n },
    ]);
    mocks.setWithdrawalItems([
      {
        ...activityItem(waitingHash, "proven_waiting"),
        account: sender,
        readyAt: String(CLAIM_AT / 1_000),
        readyAtExact: false,
        withdrawalHash: `0x${"a1".repeat(32)}`,
      },
      {
        ...activityItem(readyHash, "ready_to_finalize"),
        account: sender,
        withdrawalHash: `0x${"a2".repeat(32)}`,
      },
      // Another account's, which the history doesn't know.
      {
        ...activityItem(otherHash, "proven_waiting"),
        account: sender,
        withdrawalHash: `0x${"a3".repeat(32)}`,
      },
    ]);
    mocks.setHistoryRows([{ hash: "some-row" }]);
    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13673n,
      stage: "ready_to_finalize",
      transactionHash: readyHash,
      withdrawalHash: `0x${"a2".repeat(32)}`,
    });
    mocks.finalizeWithdrawal.mockResolvedValue("claim-hash");

    const { findByRole, getByRole, queryByRole, queryByText } = render(
      EvmTransactions,
      { target: document.body }
    );

    expect(
      await findByRole("button", {
        name: new RegExp(`Claim from about ${claimDay(CLAIM_AT, "en")}`),
      })
    ).toBeInTheDocument();
    expect(
      queryByRole("button", { name: new RegExp(otherHash.slice(0, 8)) })
    ).toBeNull();
    expect(queryByText("No transfers yet.")).toBeNull();
    expect(mocks.historyWithdrawals).toHaveBeenCalledWith([
      { hash: "some-row" },
    ]);
    // What the history knows is followed, as remembered ones are.
    expect(mocks.trackWithdrawalTransaction).toHaveBeenCalledWith(waitingHash);

    // Claim opens its steps, where the claim is sent, and goes to it.
    await fireEvent.click(
      getByRole("button", { name: "Claim 0.1 DUSK from DuskEVM" })
    );

    const claim = await findByRole("button", { name: /^claim on dusk$/i });

    await waitFor(() => expect(claim).toHaveFocus());
    await fireEvent.click(claim);

    expect(mocks.finalizeWithdrawal).toHaveBeenCalledWith(readyHash);
  });

  it("finds on DuskEVM's explorer the history's withdrawals not remembered yet, and follows them", async () => {
    const foundHash = `0x${"67".repeat(32)}`;
    const known = [{ hash: `0x${"b1".repeat(32)}`, nonce: 7n }];

    mocks.historyWithdrawals.mockReturnValue(known);
    mocks.rememberHistoryWithdrawals.mockImplementation(async () => {
      const item = {
        ...activityItem(foundHash, "submitted"),
        account: "0x9999999999999999999999999999999999999999",
        withdrawalHash: known[0].hash,
      };

      mocks.setWithdrawalItems([item]);

      return [item];
    });
    mocks.setHistoryRows([{ hash: "a-proof" }]);

    const { findByRole } = render(EvmTransactions, { target: document.body });

    expect(
      await findByRole("button", {
        name: /^DuskEVM to Dusk Sent .+ 0\.1 DUSK Pending$/,
      })
    ).toBeInTheDocument();
    expect(mocks.rememberHistoryWithdrawals).toHaveBeenCalledWith(known);
    await waitFor(() => {
      expect(mocks.trackWithdrawalTransaction).toHaveBeenCalledWith(foundHash);
    });
  });

  it("says when a withdrawal ready to prove can be claimed if it's proved now", async () => {
    const txHash = `0x${"68".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13674n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"ec".repeat(32)}`,
    });
    mocks.loadProveNowClaim.mockResolvedValue({
      at: CLAIM_AT,
      exact: true,
      overdue: false,
    });

    const { findByText, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(
      await findByText(
        `Step 2 of 3. Fee from your public account. If you prove now, you can claim from ${claimDay(CLAIM_AT, "en")}.`
      )
    ).toBeInTheDocument();
    expect(mocks.loadProveNowClaim).toHaveBeenCalledWith(txHash);
  });

  it("says before the proof how long the steps on Dusk take, as the chain said", async () => {
    const txHash = `0x${"69".repeat(32)}`;

    mocks.setTimes({
      withdrawal: {
        at: Date.now(),
        finalitySeconds: 302_400,
        maturitySeconds: 604_800,
        outputSeconds: 1_700,
      },
    });
    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13675n,
      stage: "waiting_for_output",
      transactionHash: txHash,
      withdrawalHash: `0x${"ed".repeat(32)}`,
    });

    const { findByText, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(
      await findByText(
        "Claim 7 days after you prove. You can prove about 30 minutes after sending."
      )
    ).toBeInTheDocument();
  });
});

describe("a withdrawal ready to prove: when it can be claimed if it's proved now", () => {
  const READY = {
    blockNumber: 13_700n,
    stage: "ready_to_prove",
    transactionHash: `0x${"7a".repeat(32)}`,
    withdrawalHash: `0x${"7b".repeat(32)}`,
  };
  const LATER = CLAIM_AT + 3_600_000;

  /** @param {number} at */
  const claimAt = (at) => ({ at, exact: true, overdue: false });

  /** The date the card says, if any. */
  const said = () =>
    /If you prove now, you can claim from ([^.]+)\./u.exec(
      document.body.textContent ?? ""
    )?.[1] ?? null;

  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
    await tick();
  };

  /** @param {ReturnType<typeof vi.fn>} loadProveNow */
  const renderCard = (loadProveNow) =>
    render(WithdrawalLifecycle, {
      isChecking: false,
      isSubmitting: false,
      loadProveNow: /** @type {any} */ (loadProveNow),
      selectedWithdrawal: READY,
      statusError: "",
      submittedHash: "",
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reads it again before the proof it's for expires, and stops once the card goes", async () => {
    const loadProveNow = vi
      .fn()
      .mockResolvedValueOnce(claimAt(CLAIM_AT))
      .mockResolvedValue(claimAt(LATER));
    const { unmount } = renderCard(loadProveNow);

    await flush();

    expect(said()).toBe(claimDay(CLAIM_AT, "en"));

    // 20 s before the two minutes a prepared proof is kept.
    await vi.advanceTimersByTimeAsync(99_999);

    expect(loadProveNow).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await tick();

    expect(loadProveNow).toHaveBeenCalledTimes(2);
    expect(said()).toBe(claimDay(LATER, "en"));

    unmount();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(loadProveNow).toHaveBeenCalledTimes(2);
  });

  it("tries a failed read again, each time after longer", async () => {
    const loadProveNow = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(claimAt(CLAIM_AT));

    renderCard(loadProveNow);
    await flush();

    expect(said()).toBeNull();

    await vi.advanceTimersByTimeAsync(4_999);

    expect(loadProveNow).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);

    expect(loadProveNow).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(9_999);

    expect(loadProveNow).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await tick();

    expect(loadProveNow).toHaveBeenCalledTimes(3);
    expect(said()).toBe(claimDay(CLAIM_AT, "en"));
  });

  it.each([
    // The refresh at 100 s fails, and its retries at 105 s and 115 s: the
    // next is at 135 s.
    ["can't be read again", () => Promise.reject(new Error("offline")), 4],
    ["is still being read again", () => new Promise(() => {}), 2],
  ])(
    "stops saying a date as the proof it's for expires, while it %s",
    async (_while, refresh, reads) => {
      const loadProveNow = vi
        .fn()
        .mockResolvedValueOnce(claimAt(CLAIM_AT))
        .mockImplementation(refresh);

      renderCard(loadProveNow);
      await flush();
      await vi.advanceTimersByTimeAsync(119_999);
      await tick();

      expect(loadProveNow).toHaveBeenCalledTimes(reads);
      expect(said()).toBe(claimDay(CLAIM_AT, "en"));

      // Two minutes on: the proof it was for is no longer the one sent.
      await vi.advanceTimersByTimeAsync(1);
      await tick();

      expect(said()).toBeNull();
    }
  );
});
