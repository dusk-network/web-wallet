import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { EvmTransactions } from "..";

const mocks = vi.hoisted(() => ({
  finalizeWithdrawal: vi.fn(),
  loadWithdrawalStatus: vi.fn(),
  proveWithdrawal: vi.fn(),
}));

vi.mock("$lib/bridge/withdrawals", () => ({
  finalizeWithdrawal: mocks.finalizeWithdrawal,
  getWithdrawalFinalizationConfig: () => ({
    configured: true,
    disputeGameFactoryContractId: "22".repeat(32),
    disputeGameFactoryDataDriverUrl: "/dispute_game_factory_dd_opt.wasm",
    l2RpcUrl: "https://rpc.devnet.duskevm.dusk.network",
    missing: [],
    optimismPortalContractId: "11".repeat(32),
    optimismPortalDataDriverUrl: "/optimism_portal_dd_opt.wasm",
  }),
  /**
   * @param {unknown} value
   */
  isWithdrawalTxHash: function isWithdrawalTxHash(value) {
    return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
  },
  loadWithdrawalStatus: mocks.loadWithdrawalStatus,
  proveWithdrawal: mocks.proveWithdrawal,
}));

describe("EvmTransactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the withdrawal finalization status form", () => {
    const { getByLabelText, getByRole, getByText } = render(EvmTransactions, {
      target: document.body,
    });

    expect(
      getByLabelText("L2 withdrawal transaction hash")
    ).toBeInTheDocument();
    expect(getByText("No withdrawal selected")).toBeInTheDocument();
    expect(getByRole("link", { name: /back/i }).getAttribute("href")).toMatch(
      /\/dashboard\/bridge$/
    );
  });

  it("shows the prove action when a withdrawal is ready to prove", async () => {
    const txHash = `0x${"57".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13668n,
      proofSubmitter: "0xeb9ea22334e679cdbc669cf9ad2d713b559708b1",
      provenAt: 0n,
      stage: "ready_to_prove",
      transactionHash: txHash,
      withdrawalHash: `0x${"e7".repeat(32)}`,
    });

    const { findByRole, findByText, getByLabelText, getByRole } = render(
      EvmTransactions,
      {
        target: document.body,
      }
    );

    await fireEvent.input(getByLabelText("L2 withdrawal transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /check status/i }));

    expect(await findByText("Ready to prove")).toBeInTheDocument();
    expect(
      await findByRole("button", { name: /prove withdrawal/i })
    ).toBeInTheDocument();
    expect(mocks.loadWithdrawalStatus).toHaveBeenCalledWith(txHash);
  });

  it("does not show the prove action before an output proposal is available", async () => {
    const txHash = `0x${"58".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13669n,
      proofSubmitter: "0xeb9ea22334e679cdbc669cf9ad2d713b559708b1",
      provenAt: 0n,
      stage: "waiting_for_output",
      statusMessage:
        "No finalized output proposal covering this withdrawal is ready yet.",
      transactionHash: txHash,
      withdrawalHash: `0x${"e8".repeat(32)}`,
    });

    const { findByText, getByLabelText, getByRole, queryByRole } = render(
      EvmTransactions,
      {
        target: document.body,
      }
    );

    await fireEvent.input(getByLabelText("L2 withdrawal transaction hash"), {
      target: { value: txHash },
    });
    await fireEvent.click(getByRole("button", { name: /check status/i }));

    expect(await findByText("Waiting for output proposal")).toBeInTheDocument();
    expect(await findByText("Output proposal unavailable")).toBeInTheDocument();
    expect(
      queryByRole("button", { name: /prove withdrawal/i })
    ).not.toBeInTheDocument();
  });

  it("submits proof for the checked transaction hash", async () => {
    const checkedHash = `0x${"59".repeat(32)}`;
    const editedHash = `0x${"60".repeat(32)}`;

    mocks.loadWithdrawalStatus.mockResolvedValue({
      blockNumber: 13670n,
      proofSubmitter: "0xeb9ea22334e679cdbc669cf9ad2d713b559708b1",
      provenAt: 0n,
      stage: "ready_to_prove",
      transactionHash: checkedHash,
      withdrawalHash: `0x${"e9".repeat(32)}`,
    });
    mocks.proveWithdrawal.mockResolvedValue(`0x${"aa".repeat(32)}`);

    const { findByRole, getByLabelText, getByRole } = render(EvmTransactions, {
      target: document.body,
    });

    const input = getByLabelText("L2 withdrawal transaction hash");

    await fireEvent.input(input, {
      target: { value: checkedHash },
    });
    await fireEvent.click(getByRole("button", { name: /check status/i }));
    await findByRole("button", { name: /prove withdrawal/i });
    await fireEvent.input(input, {
      target: { value: editedHash },
    });
    await fireEvent.click(getByRole("button", { name: /prove withdrawal/i }));

    expect(mocks.proveWithdrawal).toHaveBeenCalledWith(checkedHash);
  });
});
