import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";

import { EvmTransactions } from "..";

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
    configuredFinalizationConfig,
    finalizationConfig: configuredFinalizationConfig(),
    finalizeWithdrawal: vi.fn(),
    hydrateWithdrawalActivity: vi.fn(() => withdrawalItems),
    loadDuskTransactionExecution: vi.fn(),
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
    proveWithdrawal: vi.fn(),
    recordWithdrawalSubmission: vi.fn(),
    refreshWithdrawalTransaction: vi.fn(),
    rememberWithdrawalTransaction: vi.fn(),
    resumeWithdrawalTracking: vi.fn(),
    /**
     * @param {any} value
     */
    setAccount(value) {
      accountValue = value;
      subscribers.forEach((run) => run(value));
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

vi.mock("$lib/web3/walletConnection", () => ({
  account: mocks.account,
  modal: { open: mocks.modalOpen },
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
  loadWithdrawalStatus: mocks.loadWithdrawalStatus,
  proveWithdrawal: mocks.proveWithdrawal,
}));

vi.mock("$lib/bridge/withdrawalActivity", () => ({
  hydrateWithdrawalActivity: mocks.hydrateWithdrawalActivity,
  loadWithdrawalActivity: mocks.loadWithdrawalActivity,
  mergeWithdrawalActivity: mocks.mergeWithdrawalActivity,
  recordWithdrawalSubmission: mocks.recordWithdrawalSubmission,
  refreshWithdrawalTransaction: mocks.refreshWithdrawalTransaction,
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
        return "Finalized";
      case "proven_waiting":
        return "Challenge period";
      case "ready_to_finalize":
        return "Ready to finalize";
      case "ready_to_prove":
        return "Ready to prove";
      case "waiting_for_output":
        return "Waiting for output";
      default:
        return "Confirming";
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
    challengePeriodEnd: null,
    createdAt: 1_000,
    explorerStatus: null,
    l1TransactionHash: null,
    source: "local",
    stage,
    timestamp: "2026-07-14T10:00:00Z",
    transactionHash,
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
    mocks.finalizationConfig = mocks.configuredFinalizationConfig();
    mocks.setAccount({ address: undefined, isConnected: false });
    mocks.setWithdrawalItems([]);
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

  it("keeps activity and manual lookup available without an EVM wallet", async () => {
    mocks.loadWithdrawalActivity.mockImplementation(emptyActivity);

    const { findByText, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });

    expect(getByLabelText("Find by transaction hash")).toBeInTheDocument();
    expect(await findByText("Connect DuskEVM wallet")).toBeInTheDocument();
    await fireEvent.click(getByRole("button", { name: /^connect$/i }));
    expect(mocks.modalOpen).toHaveBeenCalledOnce();
    expect(getByRole("link", { name: /back/i }).getAttribute("href")).toMatch(
      /\/dashboard\/bridge$/
    );
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
      name: /0\.1 DUSK.*Waiting for output/i,
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

    const { findByRole, getAllByText, getByLabelText, getByRole } = render(
      EvmTransactions,
      { target: document.body }
    );

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(
      await findByRole("button", { name: /prove withdrawal/i })
    ).toBeInTheDocument();
    for (const label of [
      "Initiated",
      "Output available",
      "Prove withdrawal",
      "Challenge period",
      "Finalized",
    ]) {
      expect(getAllByText(label).length).toBeGreaterThan(0);
    }
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

    const { findByText, getByLabelText, getByRole, queryByRole } = render(
      EvmTransactions,
      { target: document.body }
    );

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));

    expect(
      await findByText(
        "The withdrawal is confirmed. Waiting for an output proposal."
      )
    ).toBeInTheDocument();
    expect(
      queryByRole("button", { name: /prove withdrawal/i })
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
    await findByRole("button", { name: /prove withdrawal/i });
    await fireEvent.input(input, { target: { value: editedHash } });
    await fireEvent.click(getByRole("button", { name: /prove withdrawal/i }));

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
      await findByRole("button", { name: /prove withdrawal/i })
    );
    expect((await findAllByText("Proof submitted")).length).toBeGreaterThan(0);
    expect(mocks.recordWithdrawalSubmission).toHaveBeenCalledWith(txHash, {
      action: "prove",
      hash: "65".repeat(32),
    });
    expect(
      queryByRole("button", { name: /prove withdrawal/i })
    ).not.toBeInTheDocument();
    expect(
      queryByRole("button", { name: /refresh status/i })
    ).not.toBeInTheDocument();
    expect((await findAllByText("Proof submitted")).length).toBeGreaterThan(0);
  });

  it("re-enables proof with an error when the submitted transaction fails", async () => {
    const txHash = `0x${"66".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13674n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"ed".repeat(32)}`,
    });
    mocks.proveWithdrawal.mockResolvedValue("67".repeat(32));
    const { findAllByText, findByRole, findByText, getByLabelText, getByRole } =
      render(EvmTransactions, { target: document.body });

    await fireEvent.input(getByLabelText("Find by transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await fireEvent.click(
      await findByRole("button", { name: /prove withdrawal/i })
    );
    await findAllByText("Proof submitted");

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
      await findByRole("button", { name: /prove withdrawal/i })
    ).toBeInTheDocument();
    expect(
      await findByText("Proof transaction failed: contract execution failed")
    ).toBeInTheDocument();
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

    const { findByRole, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });
    const input = getByLabelText("Find by transaction hash");

    await fireEvent.input(input, { target: { value: selectedHash } });
    await fireEvent.click(getByRole("button", { name: /^check$/i }));
    await findByRole("button", {
      name: /0\.1 DUSK.*Waiting for output/i,
    });
    await fireEvent.input(input, { target: { value: editedHash } });

    const selected = mocks
      .withdrawalItems()
      .find((item) => item.transactionHash === selectedHash);
    mocks.setWithdrawalItems([
      {
        ...selected,
        proofSubmitter: "0xeb9ea22334e679cdbc669cf9ad2d713b559708b1",
        stage: "proven_waiting",
      },
    ]);

    expect(
      await findByRole("button", {
        name: /0\.1 DUSK.*Challenge period/i,
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(mocks.loadWithdrawalStatus).not.toHaveBeenCalledWith(editedHash);
  });
});
