import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hashWithdrawal,
  parseWithdrawalReceipt,
  withdrawalStorageKey,
} from "$lib/bridge/withdrawals";

const messagePassedLog = {
  address: "0x4200000000000000000000000000000000000016",
  blockHash:
    "0x5510dbadb5bce778c1b7b331d37fcc0c86f2fe55f7b60f83b6d678b60f7726e0",
  blockNumber: "0x3564",
  data: "0x0000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000000000000007ed760000000000000000000000000000000000000000000000000000000000000080e78b3f4d6f313300774677027a3a41540ab6eeaed0c3464d5865d53553fc27860000000000000000000000000000000000000000000000000000000000000284d764ad0b00010000000000000000000000000000000000000000000000000000000000070000000000000000000000004200000000000000000000000000000000000010000000000000000000000000f44f202151ffb9742ad4391849c62be3fb441e720000000000000000000000000000000000000000000000008ac7230489e800000000000000000000000000000000000000000000000000000000000000030d4000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001841635f5fd000000000000000000000000eb9ea22334e679cdbc669cf9ad2d713b559708b1000000000000000000000000eb9ea22334e679cdbc669cf9ad2d713b559708b10000000000000000000000000000000000000000000000008ac7230489e80000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c200fafd19fa981abfac15b121a37fabbf45d8e5630d79da8d13fae7c3c5dd03afb611f1c468c1b5961b5ecdfff7bc85c319b53a1d9979c7c041926e5b7cbf5e4dfe5adc1369895d5e341a7651079b25663c58909f2cf400d4cb70651413c5cd06185747ff4aac9dfe2d947fb6fdbf470562e3ee884afbf66427e4171dc95bc41ba64f5d97e6859cb85b307108b51f15c801d14c78437c13edef03ad3d455193020a6a1c99858112912522dace4683191ae1274ddfea6e686a9724eed4012029e913000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  logIndex: "0x2",
  removed: false,
  topics: [
    "0x02a52367d10742d8032712c1bb8e0144ff1ec5ffda1ed7d70bb05a2744955054",
    "0x0001000000000000000000000000000000000000000000000000000000000007",
    "0x0000000000000000000000004200000000000000000000000000000000000007",
    "0x00000000000000000000000004ffbc4c863235f94f99ccc849de181a1ab74759",
  ],
  transactionHash:
    "0x57ac2440f740f3cdd4c90c758dcf28be7b35ed496d8b580958693d2e37883a57",
  transactionIndex: "0x1",
};

describe("DuskEVM withdrawal helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unsupported Portal and DGF data-driver URL schemes", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "11".repeat(32));
    vi.stubEnv(
      "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
      "file:///tmp/portal.wasm"
    );
    vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", "22".repeat(32));
    vi.stubEnv(
      "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
      "data:application/wasm;base64,AA=="
    );

    const { getWithdrawalFinalizationConfig } =
      await import("$lib/bridge/withdrawals");
    const config = getWithdrawalFinalizationConfig();

    expect(config.configured).toBe(false);
    expect(config.missing).toEqual([
      "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
      "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
    ]);
  });

  it("uses bundled Portal and DGF data-driver URLs when env URLs are blank", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "11".repeat(32));
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL", "");
    vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", "22".repeat(32));
    vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL", "");

    const { getWithdrawalFinalizationConfig } =
      await import("$lib/bridge/withdrawals");
    const config = getWithdrawalFinalizationConfig();

    expect(config.configured).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.optimismPortalDataDriverUrl).toBe(
      "/drivers/optimism_portal_dd_opt.wasm"
    );
    expect(config.disputeGameFactoryDataDriverUrl).toBe(
      "/drivers/dispute_game_factory_dd_opt.wasm"
    );
  });

  it("accepts relative and http data-driver URLs", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "11".repeat(32));
    vi.stubEnv(
      "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
      "/drivers/portal.wasm"
    );
    vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", "22".repeat(32));
    vi.stubEnv(
      "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
      "https://assets.example.test/dgf.wasm"
    );

    const { getWithdrawalFinalizationConfig } =
      await import("$lib/bridge/withdrawals");
    const config = getWithdrawalFinalizationConfig();

    expect(config.configured).toBe(true);
    expect(config.missing).toEqual([]);
  });

  it("parses and verifies the L2 MessagePassed withdrawal event", () => {
    const event = parseWithdrawalReceipt({
      blockHash: messagePassedLog.blockHash,
      blockNumber: messagePassedLog.blockNumber,
      logs: [messagePassedLog],
      status: "0x1",
      transactionHash: messagePassedLog.transactionHash,
    });

    expect(event.blockNumber).toBe(13668n);
    expect(event.withdrawalHash).toBe(
      "0xe78b3f4d6f313300774677027a3a41540ab6eeaed0c3464d5865d53553fc2786"
    );
    expect(hashWithdrawal(event.withdrawal)).toBe(event.withdrawalHash);
    expect(withdrawalStorageKey(event.withdrawalHash)).toBe(
      "0x11621f5996455c272294d13d1550a2df7805c8ab70fbabdc9a540e260011c3c6"
    );
  });

  it("rejects failed withdrawal receipts", () => {
    expect(() =>
      parseWithdrawalReceipt({
        blockHash: messagePassedLog.blockHash,
        blockNumber: messagePassedLog.blockNumber,
        logs: [messagePassedLog],
        status: "0x0",
        transactionHash: messagePassedLog.transactionHash,
      })
    ).toThrow("Withdrawal transaction failed on DuskEVM.");
  });

  it("rejects tampered MessagePassed payloads", () => {
    const tamperedLog = {
      ...messagePassedLog,
      data: messagePassedLog.data.replace(
        "8ac7230489e80000",
        "8ac7230489e80001"
      ),
    };

    expect(() =>
      parseWithdrawalReceipt({
        blockHash: tamperedLog.blockHash,
        blockNumber: tamperedLog.blockNumber,
        logs: [tamperedLog],
        status: "0x1",
        transactionHash: tamperedLog.transactionHash,
      })
    ).toThrow("Withdrawal hash mismatch in MessagePassed event.");
  });
});
