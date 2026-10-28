import { afterEach, describe, expect, it, vi } from "vitest";
import { readable } from "svelte/store";
import { hexToBytes, toRlp } from "viem";
import { networks } from "@dusk-network/networks";

import {
  hashWithdrawal,
  maybeAddProofNode,
  parseGameSearchDepth,
  parseWithdrawalReceipt,
  proofRequiresReplacement,
  withdrawalGas,
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

const withdrawalTxHash = /** @type {`0x${string}`} */ (
  messagePassedLog.transactionHash
);

/**
 * An `aggregate` reply as the contract writes it (rkyv 0.7): each Ok
 * result's bytes, then one 16-byte slot per result, then the root. As in
 * multicallFetch.spec.js.
 *
 * @param {{ Ok: Uint8Array }[]} results
 */
function reply(results) {
  /**
   * @param {number} n
   * @param {number} to
   */
  const align = (n, to) => Math.ceil(n / to) * to;
  const data = results.reduce((n, r) => n + r.Ok.length, 0);
  const slots = align(data, 4);
  const root = align(slots + 16 * results.length, 8);
  const out = new Uint8Array(root + 16);
  const view = new DataView(out.buffer);
  let at = 0;

  results.forEach((r, i) => {
    const slot = slots + 16 * i;

    out.set(r.Ok, at);
    view.setInt32(slot + 4, at - (slot + 4), true);
    view.setUint32(slot + 8, r.Ok.length, true);
    at += r.Ok.length;
  });
  view.setBigUint64(root, 7n, true);
  view.setInt32(root + 8, slots - (root + 8), true);
  view.setUint32(root + 12, results.length, true);

  return out;
}

/**
 * Puts the node on a network, as its chain ID names it.
 *
 * @param {import("@dusk-network/networks").Network} net
 */
function onNetwork(net) {
  vi.doMock("$lib/stores/nodeNetwork", () => ({ default: readable(net) }));
}

describe("DuskEVM withdrawal helpers", () => {
  afterEach(() => {
    vi.doUnmock("$lib/stores/nodeNetwork");
    vi.doUnmock("$lib/bridge/bridgeReads");
    vi.doUnmock("$lib/stores");
    vi.doUnmock("$lib/web3/walletConnection");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("proves and finalizes withdrawals with a large gas limit, within the global bound", () => {
    expect(withdrawalGas()).toMatchObject({ limit: 50_000_000n, price: 1n });
    expect(withdrawalGas(519_542n)).toMatchObject({ limit: 50_519_542n });
    expect(withdrawalGas(950_000_000n)).toMatchObject({
      limit: 1_000_000_000n,
    });
  });

  it("refuses a withdrawal that needs more gas than the global bound, rather than sending it short", () => {
    expect(() => withdrawalGas(950_000_001n)).toThrow(
      "This withdrawal needs more gas than the wallet allows, so it wasn't sent."
    );
    expect(() => withdrawalGas(2_000_000_000n)).toThrow();
  });

  it("falls back to a positive game search depth for invalid env values", () => {
    expect(parseGameSearchDepth(undefined)).toBe(64n);
    expect(parseGameSearchDepth("")).toBe(64n);
    expect(parseGameSearchDepth("not-a-number")).toBe(64n);
    expect(parseGameSearchDepth("0")).toBe(64n);
    expect(parseGameSearchDepth("32")).toBe(32n);
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

  it("takes the Portal, the dispute game factory and their drivers from the node's network", async () => {
    vi.resetModules();
    onNetwork(networks.testnet);

    const { getWithdrawalFinalizationConfig } =
      await import("$lib/bridge/withdrawals");
    const config = getWithdrawalFinalizationConfig();
    const contracts = networks.testnet.duskEvm?.contracts;

    expect(config).toMatchObject({
      configured: true,
      disputeGameFactoryContractId: contracts?.dispute_game_factory.contractId,
      disputeGameFactoryDataDriverUrl:
        "/drivers/dispute_game_factory_dd_opt.wasm",
      missing: [],
      optimismPortalContractId: contracts?.optimism_portal.contractId,
      optimismPortalDataDriverUrl: "/drivers/optimism_portal_dd_opt.wasm",
    });

    // A network without DuskEVM has none, unless set.
    vi.resetModules();
    onNetwork(networks.mainnet);

    const again = await import("$lib/bridge/withdrawals");

    expect(again.getWithdrawalFinalizationConfig()).toMatchObject({
      configured: false,
      optimismPortalContractId: "",
    });
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

  it.each([
    ["the network's by default", networks.testnet, "", "1735498c"],
    ["the one set", networks.testnet, `0x${"ab".repeat(32)}`, "abababab"],
    ["none with `none`", networks.testnet, "none", ""],
    ["none on a network without DuskEVM, unless set", networks.mainnet, "", ""],
  ])(
    "knows the anchor state registry the Portal asks: %s",
    async (_what, net, set, starts) => {
      vi.resetModules();
      onNetwork(net);
      vi.stubEnv("VITE_EVM_ANCHOR_STATE_REGISTRY_CONTRACT_ID", set);

      const { getWithdrawalFinalizationConfig } =
        await import("$lib/bridge/withdrawals");
      const id =
        getWithdrawalFinalizationConfig().anchorStateRegistryContractId;

      expect(id.slice(0, 8)).toBe(starts);
      expect(id).toMatch(starts ? /^[0-9a-f]{64}$/u : /^$/u);
    }
  );

  it("loads a submitted Dusk transaction execution from Rusk", async () => {
    vi.resetModules();
    const query = vi.fn().mockResolvedValue({
      tx: { blockHeight: 14_002, err: "contract execution failed" },
    });
    const connect = vi.fn().mockResolvedValue({ query });

    vi.doMock("$lib/stores", () => ({
      networkStore: { connect },
      walletStore: {},
    }));
    vi.doMock("$lib/web3/walletConnection", () => ({
      duskEvm: { rpcUrls: { default: { http: ["https://l2.example.test"] } } },
    }));

    const { loadDuskTransactionExecution } =
      await import("$lib/bridge/withdrawals");
    const execution = await loadDuskTransactionExecution(
      `0x${"AB".repeat(32)}`
    );

    expect(query).toHaveBeenCalledWith(
      `tx(hash: "${"ab".repeat(32)}") { err blockHeight }`
    );
    expect(execution).toEqual({
      blockHeight: 14_002n,
      error: "contract execution failed",
    });
  });

  it("rejects an invalid submitted Dusk transaction hash", async () => {
    const { loadDuskTransactionExecution } =
      await import("$lib/bridge/withdrawals");

    await expect(loadDuskTransactionExecution("not-a-hash")).rejects.toThrow(
      "Dusk transaction hash is invalid."
    );
  });

  it("appends directly embedded terminal nodes from branch proofs", () => {
    const key = /** @type {`0x${string}`} */ (`0x${"00".repeat(30)}0abc`);
    const terminalNode = /** @type {[`0x${string}`, `0x${string}`]} */ ([
      "0x3abc",
      "0xbeef",
    ]);
    const branchNode = /** @type {any[]} */ (Array(17).fill("0x"));

    branchNode[10] = terminalNode;

    const branchRlp = toRlp(/** @type {any} */ (branchNode));
    const terminalRlp = toRlp(terminalNode);

    expect(maybeAddProofNode(key, [branchRlp])).toEqual([
      branchRlp,
      terminalRlp,
    ]);
  });

  it("appends RLP-encoded embedded terminal nodes from branch proofs", () => {
    const key = /** @type {`0x${string}`} */ (`0x${"00".repeat(30)}0abc`);
    const terminalRlp = toRlp(
      /** @type {[`0x${string}`, `0x${string}`]} */ (["0x3abc", "0xbeef"])
    );
    const branchNode = /** @type {any[]} */ (Array(17).fill("0x"));

    branchNode[10] = terminalRlp;

    const branchRlp = toRlp(/** @type {any} */ (branchNode));

    expect(maybeAddProofNode(key, [branchRlp])).toEqual([
      branchRlp,
      terminalRlp,
    ]);
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
    expect(event.withdrawal).toMatchObject({
      gasLimit: 519_542n,
      nonce: BigInt(messagePassedLog.topics[1]),
      sender: "0x4200000000000000000000000000000000000007",
      target: "0x04ffbC4C863235f94F99CCc849DE181A1aB74759",
      value: 10_000_000_000_000_000_000n,
    });
    expect(event.withdrawal.data).toMatch(/^0xd764ad0b/);
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
    ).toThrow("MessagePassed withdrawalHash does not match event payload");
  });

  it("rejects malformed MessagePassed payloads", () => {
    const malformedLog = {
      ...messagePassedLog,
      data: "0x1234",
    };

    expect(() =>
      parseWithdrawalReceipt({
        blockHash: malformedLog.blockHash,
        blockNumber: malformedLog.blockNumber,
        logs: [malformedLog],
        status: "0x1",
        transactionHash: malformedLog.transactionHash,
      })
    ).toThrow();
  });

  it("does not replace proofs while their dispute game is progressing", () => {
    expect(
      proofRequiresReplacement({ gameStatus: 0, isGameBlacklisted: false })
    ).toBe(false);
    expect(
      proofRequiresReplacement({ gameStatus: 2, isGameBlacklisted: false })
    ).toBe(false);
  });

  it("replaces challenger-won or blacklisted dispute-game proofs", () => {
    expect(
      proofRequiresReplacement({ gameStatus: 1, isGameBlacklisted: false })
    ).toBe(true);
    expect(
      proofRequiresReplacement({ gameStatus: 0, isGameBlacklisted: true })
    ).toBe(true);
  });

  it("ignores MessagePassed-shaped logs from the wrong contract", () => {
    const wrongContractLog = {
      ...messagePassedLog,
      address: "0x4200000000000000000000000000000000000017",
    };

    expect(() =>
      parseWithdrawalReceipt({
        blockHash: wrongContractLog.blockHash,
        blockNumber: wrongContractLog.blockNumber,
        logs: [wrongContractLog],
        status: "0x1",
        transactionHash: wrongContractLog.transactionHash,
      })
    ).toThrow("Withdrawal MessagePassed event was not found.");
  });

  it("ignores non-MessagePassed logs from the message passer contract", () => {
    const wrongTopicLog = {
      ...messagePassedLog,
      topics: [`0x${"00".repeat(32)}`, ...messagePassedLog.topics.slice(1)],
    };

    expect(() =>
      parseWithdrawalReceipt({
        blockHash: wrongTopicLog.blockHash,
        blockNumber: wrongTopicLog.blockNumber,
        logs: [wrongTopicLog],
        status: "0x1",
        transactionHash: wrongTopicLog.transactionHash,
      })
    ).toThrow("Withdrawal MessagePassed event was not found.");
  });

  it("keeps a proven withdrawal waiting while the Portal refuses its claim and its game is in progress", async () => {
    const { dgf, portal } = mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    const status = await loadWithdrawalStatus(withdrawalTxHash);

    expect(status.stage).toBe("proven_waiting");
    expect(status.statusMessage).toContain("dispute game is still in progress");
    expect(portal.call.checkWithdrawal).toHaveBeenCalledOnce();
    const [[withdrawalHash, proofSubmitter]] =
      portal.call.checkWithdrawal.mock.calls[0];
    expect(withdrawalHash).toHaveLength(32);
    expect(proofSubmitter).toEqual(Array(20).fill(0x2c));
    expect(dgf.call.gameCount).not.toHaveBeenCalled();
  });

  it("dates the claim from the proof's maturity and its game: the earliest while the game is in progress", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal: proven withdrawal has not matured yet"),
      maturity: 604_800,
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    // Proven at 100: it matures at 604,900, a second later on block time.
    // The game, created at 50, is final no sooner than 50 + 302,400 + 302,400.
    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      {
        claimOverdue: false,
        proofRejected: false,
        readyAt: 604_901n,
        readyAtExact: false,
        stage: "proven_waiting",
      }
    );
  });

  it("gives the exact claim date once the proof's game has resolved", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal: proven withdrawal has not matured yet"),
      game: { createdAt: 50n, resolvedAt: 400_000n, status: 2 },
      maturity: 604_800,
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    // The game is final at 400,000 + 302,400, after the proof matures.
    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      { readyAt: 702_401n, readyAtExact: true, stage: "proven_waiting" }
    );
  });

  it("counts testnet's contract time, Dusk block height × 10, from the latest block", async () => {
    // wallet-both.dusk's withdrawal, proved at block 4,687,744 against a game
    // created at block 4,687,605: claimable from Mon 2 Nov, 03:20:39 UTC.
    mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
      game: { createdAt: 46_876_050n, resolvedAt: 0n, status: 0 },
      maturity: 604_800,
      proven: [Array(20).fill(0x1e), 46_877_440],
      tip: TESTNET_TIP,
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      {
        readyAt: BigInt(Date.UTC(2026, 10, 2, 3, 20, 39) / 1_000),
        readyAtExact: false,
        stage: "proven_waiting",
      }
    );
  });

  it("says when a proof's game is late to resolve, and the soonest it can be claimed", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
      // Its clock ran out more than an hour before the latest block.
      game: { createdAt: 46_000_000n, resolvedAt: 0n, status: 0 },
      maturity: 604_800,
      proven: [Array(20).fill(0x1e), 46_100_000],
      tip: TESTNET_TIP,
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    // It could resolve now: final 3.5 days from now, after the maturity.
    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      {
        claimOverdue: true,
        readyAt: TESTNET_TIP.timestamp + 302_400n,
        readyAtExact: false,
      }
    );
  });

  it("flags a proof whose game the challenger won, with no newer game to prove against", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
      game: { createdAt: 50n, resolvedAt: 400_000n, status: 1 },
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      { proofRejected: true, readyAt: null, stage: "proven_waiting" }
    );
  });

  it("flags a proof whose game was blacklisted", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
      isGameBlacklisted: true,
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      { proofRejected: true, readyAt: null, stage: "proven_waiting" }
    );
  });

  it("keeps the date known so far when the proof's game can't be read", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
      gameReadFails: true,
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    const status = await loadWithdrawalStatus(withdrawalTxHash);

    expect(status).toMatchObject({
      stage: "proven_waiting",
      statusMessage:
        "The proof is accepted, but its dispute game can't be read right now.",
    });
    expect("readyAt" in status).toBe(false);
  });

  it("gives no date once it has passed while the Portal still refuses the claim", async () => {
    mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
      game: { createdAt: 50n, resolvedAt: 100n, status: 2 },
      tip: { height: 1_000_000n, timestamp: 2_000_000n },
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      {
        readyAt: null,
        readyAtExact: false,
        stage: "proven_waiting",
        statusMessage: "The Portal doesn't take the claim yet.",
      }
    );
  });

  it("is ready to claim once the Portal takes the claim", async () => {
    mockWithdrawalReads({
      game: { createdAt: 50n, resolvedAt: 400n, status: 2 },
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    await expect(loadWithdrawalStatus(withdrawalTxHash)).resolves.toMatchObject(
      {
        disputeGameProxy: `0x${"1e".repeat(20)}`,
        readyAtExact: true,
        stage: "ready_to_finalize",
      }
    );
  });

  it("reads the game on its own hub, which the factory names, and never through the adapter's L1 view", async () => {
    const { dgf, hubs } = mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
    });
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    await loadWithdrawalStatus(withdrawalTxHash);

    expect(dgf.call.gameContractId).toHaveBeenCalledWith(Array(20).fill(0x1e));
    // The game and its hub's clock limit, on the hub the factory named.
    expect(new Set(hubs)).toStrictEqual(new Set(["d5".repeat(32)]));
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.map(([, init]) => JSON.parse(String(init?.body)).method)
    ).toStrictEqual(["eth_getTransactionReceipt"]);
  });

  describe("a withdrawal's waits", () => {
    const NODE = "https://node.example.test";
    const PORTAL = "11".repeat(32);
    const DGF = "22".repeat(32);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /** Drivers that read and answer JSON. */
    const driver = /** @type {BridgeDriver} */ ({
      decodeOutputFn: (_fn, bytes) => JSON.parse(decoder.decode(bytes)),
      encodeInputFn: (_fn, json) => encoder.encode(json),
    });

    /** As DuskEVM testnet's on 27 Oct 2026: an output every 170 Dusk blocks. */
    const ANSWERS = {
      disputeGameFinalityDelaySeconds: u256(302_400),
      findLatestGames: [
        46_986_550, 46_984_850, 46_983_150, 46_979_750, 46_978_050, 46_976_350,
      ].map((timestamp) => ({ timestamp })),
      gameCount: u256(3_915),
      proofMaturityDelaySeconds: u256(604_800),
      respectedGameType: 8,
    };

    async function timingModule() {
      vi.resetModules();
      // DuskEVM testnet's drivers, and the contracts set.
      onNetwork(networks.testnet);
      vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", PORTAL);
      vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", DGF);

      return await import("$lib/bridge/withdrawals");
    }

    it("are the Portal's delays, and how often outputs come from the latest games", async () => {
      const { loadWithdrawalTiming } = await timingModule();
      /** @type {string[]} */
      const asked = [];
      const fetch = vi.fn(async (/** @type {string} */ url, init) => {
        const [, id, fn] = /contracts:([0-9a-f]+)\/(\w+)$/.exec(url) ?? [];

        asked.push(
          `${id === PORTAL ? "portal" : "dgf"}.${fn}(${decoder.decode(init.body)})`
        );

        return new Response(
          JSON.stringify(ANSWERS[/** @type {keyof typeof ANSWERS} */ (fn)])
        );
      });

      await expect(
        loadWithdrawalTiming({
          fetch: /** @type {typeof globalThis.fetch} */ (
            /** @type {unknown} */ (fetch)
          ),
          loadDriver: async () => driver,
          nodeUrl: NODE,
        })
      ).resolves.toStrictEqual({
        finalitySeconds: 302_400,
        maturitySeconds: 604_800,
        // Five gaps, one twice as long: the middle one counts.
        outputSeconds: 1_700,
      });
      // The latest six games of the type the Portal takes.
      expect(asked.at(-1)).toBe(
        `dgf.findLatestGames(${JSON.stringify([8, u256(3_914), u256(6)])})`
      );
    });

    it("go to the node as one Multicall for Dusk query, then the games", async () => {
      const { loadWithdrawalTiming } = await timingModule();
      const { MULTICALL_CONTRACT_ID } =
        await import("$lib/activity/multicallFetch");
      const AGGREGATE = `${NODE}/on/contracts:${MULTICALL_CONTRACT_ID}/aggregate`;
      const base = vi.fn(async (/** @type {string} */ url) =>
        url === AGGREGATE
          ? new Response(
              reply(
                [
                  ANSWERS.proofMaturityDelaySeconds,
                  ANSWERS.disputeGameFinalityDelaySeconds,
                  ANSWERS.respectedGameType,
                  ANSWERS.gameCount,
                ].map((answer) => ({
                  Ok: encoder.encode(JSON.stringify(answer)),
                }))
              )
            )
          : new Response(JSON.stringify(ANSWERS.findLatestGames))
      );
      const { createMulticallFetch } =
        await import("$lib/activity/multicallFetch");

      await expect(
        loadWithdrawalTiming({
          fetch: createMulticallFetch({
            fetch: /** @type {typeof globalThis.fetch} */ (
              /** @type {unknown} */ (base)
            ),
            nodeUrl: NODE,
          }),
          loadDriver: async () => driver,
          nodeUrl: NODE,
        })
      ).resolves.toMatchObject({ outputSeconds: 1_700 });
      expect(base.mock.calls.map(([url]) => url)).toStrictEqual([
        AGGREGATE,
        `${NODE}/on/contracts:${DGF}/findLatestGames`,
      ]);
    });
  });

  it("checks readiness for the wallet submitter rather than a third party", async () => {
    const { portal, walletStore } = mockWithdrawalReads();
    const { loadWithdrawalStatus } = await import("$lib/bridge/withdrawals");

    const status = await loadWithdrawalStatus(withdrawalTxHash);

    expect(status.proofSubmitter).toBe(`0x${"2c".repeat(20)}`);
    expect(walletStore.getDuskEvmProofSubmitter).toHaveBeenCalledOnce();
    expect(portal.call.proofSubmitters).not.toHaveBeenCalled();
    expect(portal.call.checkWithdrawal).toHaveBeenCalledWith([
      expect.any(Array),
      Array(20).fill(0x2c),
    ]);
  });

  it("refuses to submit finalization for already-finalized withdrawals", async () => {
    const { walletStore } = mockWithdrawalReads({ finalized: true });
    const { finalizeWithdrawal } = await import("$lib/bridge/withdrawals");

    await expect(finalizeWithdrawal(withdrawalTxHash)).rejects.toThrow(
      "The withdrawal is already finalized."
    );
    expect(walletStore.finalizeDuskEvmWithdrawal).not.toHaveBeenCalled();
  });

  it("reloads readiness before finalization and refuses stale ready state", async () => {
    const { walletStore } = mockWithdrawalReads({
      check: refusal("OptimismPortal2: invalid dispute game"),
    });
    const { finalizeWithdrawal } = await import("$lib/bridge/withdrawals");

    await expect(finalizeWithdrawal(withdrawalTxHash)).rejects.toThrow(
      "The proof is accepted. Its dispute game is still in progress."
    );
    expect(walletStore.finalizeDuskEvmWithdrawal).not.toHaveBeenCalled();
  });

  it("doesn't submit a finalization that needs more gas than the global bound", async () => {
    const { walletStore } = mockWithdrawalReads({
      gasLimitUpper: 50_000_000n,
    });
    const { finalizeWithdrawal } = await import("$lib/bridge/withdrawals");

    await expect(finalizeWithdrawal(withdrawalTxHash)).rejects.toThrow(
      "This withdrawal needs more gas than the wallet allows, so it wasn't sent."
    );
    expect(walletStore.finalizeDuskEvmWithdrawal).not.toHaveBeenCalled();
  });

  it("submits the SDK-serialized withdrawal through the Portal data driver", async () => {
    const { walletStore } = mockWithdrawalReads();
    const { finalizeWithdrawal } = await import("$lib/bridge/withdrawals");

    await expect(finalizeWithdrawal(withdrawalTxHash)).resolves.toBe(
      "finalize-hash"
    );

    const [, , withdrawal, gas] =
      walletStore.finalizeDuskEvmWithdrawal.mock.calls[0];

    // The withdrawal gas limit plus the gas the withdrawal asks for.
    expect(gas).toMatchObject({ limit: 50_519_542n, price: 2n });

    expect(withdrawal).toMatchObject({
      data: expect.any(Array),
      nonce: expect.any(Array),
      sender: expect.any(Array),
      target: expect.any(Array),
      value: expect.any(Array),
    });
    expect(Reflect.get(withdrawal, "gas_limit")).toEqual(expect.any(Array));
    expect(withdrawal.data.slice(0, 4)).toEqual([0xd7, 0x64, 0xad, 0x0b]);
    expect(withdrawal.gas_limit).toHaveLength(32);
    expect(withdrawal.nonce).toHaveLength(32);
    expect(withdrawal.sender).toHaveLength(20);
    expect(withdrawal.target).toHaveLength(20);
    expect(withdrawal.value).toHaveLength(32);
  });

  it("reads when the history's proved withdrawals can be claimed: claimed, ready, a date, or none", async () => {
    const { portal } = mockWithdrawalReads({ maturity: 604_800 });
    const hash = (/** @type {number} */ byte) =>
      /** @type {`0x${string}`} */ (`0x${byte.toString(16).repeat(64)}`);
    const proofs = {
      [hash(0xa)]: [Array(20).fill(0x1e), 100],
      [hash(0xb)]: [Array(20).fill(0x1e), 100],
      [hash(0xc)]: [Array(20).fill(0x1e), 100],
      // Another account's proof only.
      [hash(0xd)]: [Array(20).fill(0), 0],
    };

    portal.call.finalizedWithdrawals.mockImplementation(
      async (/** @type {number[]} */ id) => id[0] === 0xaa
    );
    portal.call.provenWithdrawals.mockImplementation(
      async (/** @type {any[]} */ [id]) =>
        proofs[
          `0x${Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("")}`
        ]
    );
    portal.call.checkWithdrawal.mockImplementation(
      async (/** @type {any[]} */ [id]) => {
        if (id[0] !== 0xbb) {
          throw new Error(
            "OptimismPortal: proven withdrawal has not matured yet"
          );
        }
      }
    );

    const { readWithdrawalClaims } = await import("$lib/bridge/withdrawals");
    const claims = await readWithdrawalClaims(
      [hash(0xa), hash(0xb), hash(0xc), hash(0xd)],
      { submitter: `0x${"2c".repeat(20)}` }
    );

    expect(claims.get(hash(0xa))).toMatchObject({ at: null, claimed: true });
    expect(claims.get(hash(0xb))).toMatchObject({
      claimed: false,
      ready: true,
    });
    // Proven at 100: it matures at 604,900, a second later on block time.
    expect(claims.get(hash(0xc))).toStrictEqual({
      at: 604_901_000,
      claimed: false,
      exact: false,
      overdue: false,
      ready: false,
      reprove: false,
    });
    expect(claims.get(hash(0xd))).toMatchObject({ at: null, ready: false });
    // The account's own proofs: its submitter's.
    expect(portal.call.provenWithdrawals).toHaveBeenCalledWith([
      expect.any(Array),
      Array(20).fill(0x2c),
    ]);
  });

  it("gives no claim date for a proof whose game was blacklisted, or that the challenger won, but that it must be made again", async () => {
    const { hub, portal } = mockWithdrawalReads({ maturity: 604_800 });
    const hash = (/** @type {number} */ byte) =>
      /** @type {`0x${string}`} */ (`0x${byte.toString(16).repeat(64)}`);
    // Each proof's game: 0x1e… blacklisted, 0x2f… the challenger won, 0x3a… waiting.
    const games = {
      [hash(0xa)]: Array(20).fill(0x1e),
      [hash(0xb)]: Array(20).fill(0x2f),
      [hash(0xc)]: Array(20).fill(0x3a),
    };

    portal.call.provenWithdrawals.mockImplementation(
      async (/** @type {any[]} */ [id]) => [
        games[
          `0x${Array.from(id, (b) => b.toString(16).padStart(2, "0")).join("")}`
        ],
        100,
      ]
    );
    portal.call.checkWithdrawal.mockRejectedValue(
      new Error("OptimismPortal: invalid dispute game")
    );
    portal.call.disputeGameBlacklist.mockImplementation(
      async (/** @type {number[]} */ address) => address[0] === 0x1e
    );
    hub.statusForGame.mockImplementation(async (/** @type {number[]} */ a) =>
      a[0] === 0x2f ? 1 : 0
    );

    const { readWithdrawalClaims } = await import("$lib/bridge/withdrawals");
    const claims = await readWithdrawalClaims(
      [hash(0xa), hash(0xb), hash(0xc)],
      { submitter: `0x${"2c".repeat(20)}` }
    );
    const again = {
      at: null,
      claimed: false,
      exact: false,
      overdue: false,
      ready: false,
      reprove: true,
    };

    expect(claims.get(hash(0xa))).toStrictEqual(again);
    expect(claims.get(hash(0xb))).toStrictEqual(again);
    expect(claims.get(hash(0xc))).toMatchObject({
      at: 604_901_000,
      reprove: false,
    });
  });

  describe("reads through Multicall for Dusk", () => {
    const NODE = "https://node.example.test";
    const PORTAL = "11".repeat(32);
    const DGF = "22".repeat(32);
    const HUB = "d5".repeat(32);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    /** Drivers that read and answer JSON. */
    const driver = /** @type {BridgeDriver} */ ({
      decodeOutputFn: (_fn, bytes) => JSON.parse(decoder.decode(bytes)),
      encodeInputFn: (_fn, json) => encoder.encode(json),
    });

    /** @param {bigint} value */
    const u64 = (value) => {
      const out = new Uint8Array(8);

      new DataView(out.buffer).setBigUint64(0, value, true);

      return out;
    };

    /**
     * What the node answers each read with: the Portal's and the factory's
     * as JSON, the hub's raw.
     *
     * @param {string} contract
     * @param {string} fn
     */
    function answer(contract, fn) {
      const portal = {
        disputeGameBlacklist: false,
        disputeGameFinalityDelaySeconds: u256(302_400),
        finalizedWithdrawals: false,
        numProofSubmitters: u256(1),
        proofMaturityDelaySeconds: u256(604_800),
        provenWithdrawals: [Array(20).fill(0x1e), 46_877_440],
      };
      const hub = {
        createdAtForGame: u64(46_876_050n),
        maxClockDuration: u64(302_400n),
        resolvedAtForGame: u64(0n),
        statusForGame: Uint8Array.of(0),
      };

      if (contract === HUB) {
        return hub[/** @type {keyof typeof hub} */ (fn)];
      }

      // The Portal refuses the claim: no answer its driver reads.
      if (fn === "checkWithdrawal") {
        return encoder.encode("refused");
      }

      return encoder.encode(
        JSON.stringify(
          contract === DGF
            ? Array.from({ length: 32 }, () => 0xd5)
            : portal[/** @type {keyof typeof portal} */ (fn)]
        )
      );
    }

    /**
     * The calls in an `aggregate` envelope: each one's contract, name and
     * arguments, as the vendored codec writes them.
     *
     * @param {any} body
     */
    function envelopeCalls(body) {
      const u8 = new Uint8Array(body);
      const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const root = u8.length - 8;
      const array = root + view.getInt32(root, true);

      return Array.from({ length: view.getUint32(root + 4, true) }, (_, i) => {
        const slot = array + 56 * i;
        const inline = u8[slot + 39] <= 7;
        const name = inline
          ? slot + 32
          : slot + 32 + view.getInt32(slot + 36, true);
        const length = inline ? u8[slot + 39] : view.getUint32(slot + 32, true);

        return {
          contract: Array.from(u8.subarray(slot, slot + 32), (b) =>
            b.toString(16).padStart(2, "0")
          ).join(""),
          fn: decoder.decode(u8.subarray(name, name + length)),
        };
      });
    }

    /**
     * The bridge's reads through Multicall for Dusk, from a node that
     * answers each read as `answer` does, and each query's reads.
     */
    async function batchedReads() {
      mockWithdrawalReads({ tip: TESTNET_TIP });
      vi.doUnmock("$lib/bridge/bridgeReads");

      const { MULTICALL_CONTRACT_ID, createMulticallFetch } =
        await import("$lib/activity/multicallFetch");
      const { bridgeReads } = await import("$lib/bridge/bridgeReads");
      const AGGREGATE = `${NODE}/on/contracts:${MULTICALL_CONTRACT_ID}/aggregate`;
      /** @type {string[][]} */
      const queries = [];
      const base = vi.fn(async (/** @type {string} */ url, init) => {
        if (url !== AGGREGATE) {
          const [, id, fn] = /contracts:([0-9a-f]+)\/(\w+)$/.exec(url) ?? [];

          queries.push([fn]);

          return new Response(answer(id, fn).slice());
        }

        const calls = envelopeCalls(init.body);

        queries.push(calls.map(({ fn }) => fn));

        return new Response(
          reply(calls.map(({ contract, fn }) => ({ Ok: answer(contract, fn) })))
        );
      });
      const reads = bridgeReads({
        config: {
          disputeGameFactoryContractId: DGF,
          disputeGameFactoryDataDriverUrl: "/dgf.wasm",
          optimismPortalContractId: PORTAL,
          optimismPortalDataDriverUrl: "/portal.wasm",
        },
        fetch: createMulticallFetch({
          fetch: /** @type {typeof globalThis.fetch} */ (
            /** @type {unknown} */ (base)
          ),
          nodeUrl: NODE,
        }),
        loadDriver: async () => driver,
        nodeUrl: NODE,
      });

      return {
        queries,
        reads,
        withdrawals: await import("$lib/bridge/withdrawals"),
      };
    }

    it("check a waiting withdrawal in one query once its game's hub is known", async () => {
      const {
        queries,
        reads,
        withdrawals: { loadWithdrawalStatus },
      } = await batchedReads();
      const first = await loadWithdrawalStatus(withdrawalTxHash, { reads });

      expect(first).toMatchObject({
        readyAt: BigInt(Date.UTC(2026, 10, 2, 3, 20, 39) / 1_000),
        stage: "proven_waiting",
      });
      // The Portal, then the game's hub, then the game with its blacklisting.
      expect(queries).toStrictEqual([
        [
          "finalizedWithdrawals",
          "numProofSubmitters",
          "provenWithdrawals",
          "proofMaturityDelaySeconds",
          "disputeGameFinalityDelaySeconds",
          "checkWithdrawal",
        ],
        ["gameContractId"],
        [
          "createdAtForGame",
          "resolvedAtForGame",
          "statusForGame",
          "maxClockDuration",
          "disputeGameBlacklist",
        ],
      ]);

      queries.length = 0;

      await expect(
        loadWithdrawalStatus(withdrawalTxHash, {
          proofGame: first.disputeGameProxy,
          reads,
        })
      ).resolves.toMatchObject({ readyAt: first.readyAt });
      // The next check: one query, the game's reads with the Portal's.
      expect(queries).toStrictEqual([
        [
          "createdAtForGame",
          "resolvedAtForGame",
          "statusForGame",
          "disputeGameBlacklist",
          "finalizedWithdrawals",
          "numProofSubmitters",
          "provenWithdrawals",
          "proofMaturityDelaySeconds",
          "disputeGameFinalityDelaySeconds",
          "checkWithdrawal",
        ],
      ]);
    });

    it("read the history's claim dates with each proof's game and whether it was blacklisted, in one query", async () => {
      const {
        queries,
        reads,
        withdrawals: { readWithdrawalClaims },
      } = await batchedReads();
      const hash = /** @type {`0x${string}`} */ (`0x${"ec".repeat(32)}`);

      const claims = await readWithdrawalClaims([hash], {
        reads,
        submitter: `0x${"2c".repeat(20)}`,
      });

      expect(claims.get(hash)).toMatchObject({
        at: Date.UTC(2026, 10, 2, 3, 20, 39),
        reprove: false,
      });
      // The Portal's record, then the game's hub, then the game with its
      // blacklisting.
      expect(queries).toStrictEqual([
        [
          "proofMaturityDelaySeconds",
          "disputeGameFinalityDelaySeconds",
          "finalizedWithdrawals",
          "provenWithdrawals",
          "checkWithdrawal",
        ],
        ["gameContractId"],
        [
          "createdAtForGame",
          "resolvedAtForGame",
          "statusForGame",
          "maxClockDuration",
          "disputeGameBlacklist",
        ],
      ]);
    });
  });

  describe("proving", () => {
    /** The factory's games: one every 1,800 s, the newest at the latest block's time. */
    const COUNT = 400;
    const TIP = { height: 1_000_000n, timestamp: 2_000_000n };

    /** @param {number} index */
    const created = (index) => 2_000_000 - (COUNT - 1 - index) * 1_800;

    /** @param {number} index */
    const l2Block = (index) => 10_000 + 100 * index;

    /** @param {number} index */
    const proxyOf = (index) => [
      ...Array(18).fill(0x9a),
      index >> 8,
      index & 0xff,
    ];

    /**
     * The proof DuskEVM gives for any block, and the root claim that makes
     * it a game's own.
     */
    const BLOCK = {
      hash: `0x${"b1".repeat(32)}`,
      stateRoot: `0x${"b2".repeat(32)}`,
    };
    const STORAGE_HASH = `0x${"b3".repeat(32)}`;

    /** Games old enough have resolved: their clock ran out, and their resolver's lag passed. */
    const OLD = (/** @type {number} */ index) =>
      created(index) <= 2_000_000 - 302_400 - 3_600;

    /**
     * @param {{
     *   proper?: (index: number) => boolean,
     *   resolved: (index: number) => boolean,
     *   respected?: (index: number) => boolean,
     *   updatedAt?: number,
     * }} options What the games' hub and the anchor state registry say
     */
    async function proving({
      proper = () => true,
      resolved,
      respected = () => true,
      updatedAt = 0,
    }) {
      const { dgf, hub, portal, reads, registry, walletStore } =
        mockWithdrawalReads({
          maturity: 604_800,
          tip: TIP,
        });
      const { hashOutputRootProof } = await import("$lib/bridge/withdrawals");
      const rootClaim = hexToBytes(
        hashOutputRootProof({
          latestBlockhash: /** @type {`0x${string}`} */ (BLOCK.hash),
          messagePasserStorageRoot: /** @type {`0x${string}`} */ (STORAGE_HASH),
          stateRoot: /** @type {`0x${string}`} */ (BLOCK.stateRoot),
          version: /** @type {`0x${string}`} */ (`0x${"00".repeat(32)}`),
        })
      );
      /** @param {number} index */
      const index32 = (index) => u256(index);
      const indexOf = (/** @type {number[]} */ bytes) =>
        Number(BigInt(`0x${Buffer.from(bytes).toString("hex")}`));
      const byProxy = (/** @type {number[]} */ address) =>
        (address[18] << 8) | address[19];

      portal.call.respectedGameType.mockResolvedValue(8);
      dgf.call.gameCount.mockResolvedValue(u256(COUNT));
      dgf.call.virtualGameHubId.mockResolvedValue(Array(32).fill(0xd5));
      dgf.call.findLatestGames.mockImplementation(
        async (/** @type {any[]} */ [, start, size]) => {
          const from = indexOf(start);

          return Array.from(
            { length: Math.min(indexOf(size), from + 1) },
            (_, k) => {
              const index = from - k;

              return {
                ["extra_data"]: u256(l2Block(index)),
                index: index32(index),
                metadata: [
                  0,
                  0,
                  0,
                  8,
                  ...u256(created(index)).slice(24),
                  ...proxyOf(index),
                ],
                ["root_claim"]: Array.from(rootClaim),
                timestamp: created(index),
              };
            }
          );
        }
      );
      dgf.call.gameMetadataAtIndex.mockImplementation(
        async (/** @type {number[]} */ index) => ({
          extraData: [],
          l2SequenceNumber: u256(l2Block(indexOf(index))),
          rootClaim: Array.from(rootClaim),
        })
      );
      dgf.call.gameAtIndex.mockImplementation(
        async (/** @type {number[]} */ index) => [
          8,
          created(indexOf(index)),
          proxyOf(indexOf(index)),
        ]
      );
      hub.statusForGame.mockImplementation(async (/** @type {number[]} */ a) =>
        resolved(byProxy(a)) ? 2 : 0
      );
      hub.createdAtForGame.mockImplementation(
        async (/** @type {number[]} */ a) => BigInt(created(byProxy(a)))
      );
      hub.resolvedAtForGame.mockImplementation(
        async (/** @type {number[]} */ a) =>
          resolved(byProxy(a)) ? BigInt(created(byProxy(a)) + 303_000) : 0n
      );
      registry.call.isGameProper.mockImplementation(
        async (/** @type {number[]} */ a) => proper(byProxy(a))
      );
      registry.call.isGameRespected.mockImplementation(
        async (/** @type {number[]} */ a) => respected(byProxy(a))
      );
      registry.call.respectedGameTypeUpdatedAt.mockResolvedValue(
        BigInt(updatedAt)
      );
      stubL2Proofs();

      return {
        reads,
        registry,
        walletStore,
        ...(await import("$lib/bridge/withdrawals")),
      };
    }

    it("proves against a covering game that has already resolved, so the claim date is exact", async () => {
      // Games old enough have resolved.
      const { prepareProof, proveWithdrawal, walletStore } = await proving({
        resolved: OLD,
      });

      const prepared = await prepareProof(withdrawalTxHash);

      // The newest of them: its clock ran out, and its resolver's lag passed.
      expect(prepared.proof).toMatchObject({ disputeGameIndex: 229n });
      // Proved now: exactly the maturity from now, a second later on block time.
      expect(prepared.claim).toStrictEqual({
        at: (2_000_000 + 604_800 + 1) * 1_000,
        exact: true,
        overdue: false,
      });

      await proveWithdrawal(withdrawalTxHash);

      const [, , args] = walletStore.proveDuskEvmWithdrawal.mock.calls[0];

      // The proof whose date was shown.
      expect(args[1]).toEqual(u256(229));
    });

    it("keeps proving with the proof whose date is shown when a newer one's date can't be read", async () => {
      let resolved = OLD;
      const { prepareProof, proveWithdrawal, reads, walletStore } =
        await proving({ resolved: (index) => resolved(index) });

      expect((await prepareProof(withdrawalTxHash)).proof).toMatchObject({
        disputeGameIndex: 229n,
      });

      // Read again, the proof goes against another game, whose date can't be read.
      resolved = () => false;
      reads.portal.call.proofMaturityDelaySeconds.mockRejectedValueOnce(
        new Error("The Portal can't be read")
      );

      const again = await prepareProof(withdrawalTxHash);

      expect(again.proof).toMatchObject({ disputeGameIndex: 399n });
      expect(again.claim).toBeNull();

      await proveWithdrawal(withdrawalTxHash);

      const [, , args] = walletStore.proveDuskEvmWithdrawal.mock.calls[0];

      // The proof of the date still shown.
      expect(args[1]).toEqual(u256(229));
    });

    it("proves against the newest covering game when none has resolved, its date the earliest", async () => {
      const { prepareProof } = await proving({ resolved: () => false });

      const prepared = await prepareProof(withdrawalTxHash);

      expect(prepared.proof).toMatchObject({ disputeGameIndex: 399n });
      expect(prepared.claim).toMatchObject({ exact: false });
    });

    it("passes over resolved games the Portal wouldn't take: improper or unrespected, as the registry it asks says", async () => {
      const { prepareProof, registry } = await proving({
        // Blacklisted or retired.
        proper: (index) => index !== 229,
        resolved: OLD,
        // Of a game type no longer respected.
        respected: (index) => index !== 228,
      });

      const prepared = await prepareProof(withdrawalTxHash);

      expect(prepared.proof).toMatchObject({ disputeGameIndex: 227n });
      expect(prepared.claim).toMatchObject({ exact: true });
      // Asked of each game by its address.
      expect(registry.call.isGameProper).toHaveBeenCalledWith(proxyOf(229));
      expect(registry.call.isGameRespected).toHaveBeenCalledWith(proxyOf(228));
    });

    it("passes over games made at or before the respected game type last changed", async () => {
      const after = await proving({
        resolved: OLD,
        updatedAt: created(229) - 1,
      });

      expect((await after.prepareProof(withdrawalTxHash)).proof).toMatchObject({
        disputeGameIndex: 229n,
      });

      // Made when it changed, or before: none old enough is left.
      const at = await proving({ resolved: OLD, updatedAt: created(229) });

      expect((await at.prepareProof(withdrawalTxHash)).proof).toMatchObject({
        disputeGameIndex: 399n,
      });
    });

    it("asks the registry about ten games a query, newest first, until one passes", async () => {
      const { prepareProof, registry } = await proving({
        proper: (index) => index < 220,
        resolved: OLD,
      });

      const prepared = await prepareProof(withdrawalTxHash);

      expect(prepared.proof).toMatchObject({ disputeGameIndex: 219n });
      // 229 to 220, then 219 to 210: no more.
      expect(registry.call.isGameProper).toHaveBeenCalledTimes(20);
      expect(registry.call.respectedGameTypeUpdatedAt).toHaveBeenCalledOnce();
    });

    it.each([
      ["no resolved game passes", { proper: () => false, resolved: OLD }],
      ["the anchor state registry isn't known", { resolved: OLD }],
    ])(
      "proves against the newest covering game when %s, its date the earliest",
      async (_when, options) => {
        const { prepareProof, reads } = await proving(options);

        if (!("proper" in options)) {
          reads.registry = null;
        }

        const prepared = await prepareProof(withdrawalTxHash);

        expect(prepared.proof).toMatchObject({ disputeGameIndex: 399n });
        expect(prepared.claim).toMatchObject({ exact: false });
      }
    );
  });
});

/**
 * @param {bigint | number} value
 */
function u256(value) {
  let remaining = BigInt(value);
  const out = Array(32).fill(0);

  for (let i = out.length - 1; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  return out;
}

/** The latest testnet block, as read on 28 Oct 2026. */
const TESTNET_TIP = Object.freeze({
  height: 4_704_959n,
  timestamp: 1_793_156_989n,
});

/**
 * A read the contract refuses, as the Portal refuses a claim.
 *
 * @param {string} message
 */
const refusal = (message) => vi.fn().mockRejectedValue(new Error(message));

/**
 * The bridge's contracts on Dusk as fakes: the Portal, the factory and a
 * game's hub answer as given. The stores give the node's gas price, the
 * latest block and the wallet's account; DuskEVM gives the withdrawal's
 * receipt.
 *
 * @param {object} [options]
 * @param {ReturnType<typeof vi.fn>} [options.check] The Portal's check of a claim now
 * @param {boolean} [options.finalized]
 * @param {{ createdAt: bigint, resolvedAt: bigint, status: number }} [options.game]
 * @param {boolean} [options.gameReadFails]
 * @param {bigint} [options.gasLimitUpper]
 * @param {boolean} [options.isGameBlacklisted]
 * @param {number} [options.maturity] The Portal's proof maturity delay
 * @param {unknown[]} [options.proven] The Portal's record of the account's proof
 * @param {{ height: bigint, timestamp: bigint }} [options.tip]
 */
function mockWithdrawalReads({
  check = vi.fn().mockResolvedValue(undefined),
  finalized = false,
  game = { createdAt: 50n, resolvedAt: 0n, status: 0 },
  gameReadFails = false,
  gasLimitUpper = 1_000_000_000n,
  isGameBlacklisted = false,
  maturity = 0,
  proven = [Array(20).fill(0x1e), 100n],
  tip = { height: 1_000_000n, timestamp: 200n },
} = {}) {
  vi.resetModules();
  vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "11".repeat(32));
  vi.stubEnv(
    "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
    "/drivers/optimism_portal_dd_opt.wasm"
  );
  vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", "22".repeat(32));
  vi.stubEnv(
    "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
    "/drivers/dispute_game_factory_dd_opt.wasm"
  );

  const proofSubmitter = Array(20).fill(0x2c);
  const portal = {
    call: {
      checkWithdrawal: check,
      disputeGameBlacklist: vi.fn().mockResolvedValue(isGameBlacklisted),
      disputeGameFinalityDelaySeconds: vi.fn().mockResolvedValue(u256(302_400)),
      finalizedWithdrawals: vi.fn().mockResolvedValue(finalized),
      numProofSubmitters: vi.fn().mockResolvedValue(u256(1)),
      proofMaturityDelaySeconds: vi.fn().mockResolvedValue(u256(maturity)),
      proofSubmitters: vi.fn().mockResolvedValue(proofSubmitter),
      provenWithdrawals: vi.fn().mockResolvedValue(proven),
      respectedGameType: vi.fn().mockResolvedValue(0),
    },
  };
  const dgf = {
    call: {
      findLatestGames: vi.fn().mockResolvedValue([]),
      gameAtIndex: vi.fn(),
      gameContractId: vi.fn().mockResolvedValue(Array(32).fill(0xd5)),
      gameCount: vi.fn().mockResolvedValue(u256(0)),
      gameMetadataAtIndex: vi.fn(),
      virtualGameHubId: vi.fn().mockResolvedValue(Array(32).fill(0xd5)),
    },
  };
  const read = (/** @type {unknown} */ value) =>
    gameReadFails
      ? vi.fn().mockRejectedValue(new Error("The hub can't be read"))
      : vi.fn().mockResolvedValue(value);
  const hub = {
    createdAtForGame: read(game.createdAt),
    maxClockDuration: read(302_400n),
    resolvedAtForGame: read(game.resolvedAt),
    statusForGame: read(game.status),
  };
  /** @type {string[]} */
  const hubs = [];
  // The anchor state registry: every game proper and respected, the
  // respected game type set before any of them.
  const registry = {
    call: {
      isGameProper: vi.fn().mockResolvedValue(true),
      isGameRespected: vi.fn().mockResolvedValue(true),
      respectedGameTypeUpdatedAt: vi.fn().mockResolvedValue(0n),
    },
  };
  /** @type {any} */
  const reads = {
    dgf,
    hub: (/** @type {string} */ id) => {
      hubs.push(id);

      return { call: hub };
    },
    nodeUrl: "https://node.example.test",
    portal,
    registry,
  };
  const walletStore = {
    finalizeDuskEvmWithdrawal: vi
      .fn()
      .mockResolvedValue({ hash: "finalize-hash" }),
    getDuskEvmProofSubmitter: vi.fn().mockReturnValue(`0x${"2c".repeat(20)}`),
    proveDuskEvmWithdrawal: vi.fn().mockResolvedValue({ hash: "prove-hash" }),
  };
  const networkStore = {
    getLatestBlock: vi.fn().mockResolvedValue(tip),
  };

  vi.doMock("$lib/bridge/bridgeReads", async (importOriginal) => ({
    .../** @type {object} */ (await importOriginal()),
    bridgeReads: () => reads,
  }));
  vi.doMock("$lib/stores", () => ({
    // The node's gas price, as no custom one is set.
    gasPriceStore: readable(2n),
    gasStore: readable({
      gasLimitLower: 2_000_000n,
      gasLimitUpper,
      gasPriceLower: 1n,
    }),
    networkStore,
    settingsStore: readable({ customGasLimit: null, customGasPrice: null }),
    walletStore,
  }));
  vi.doMock("$lib/web3/walletConnection", () => ({
    duskEvm: {
      rpcUrls: {
        default: {
          http: ["https://l2.example.test"],
        },
      },
    },
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({
        result: {
          blockHash: messagePassedLog.blockHash,
          blockNumber: messagePassedLog.blockNumber,
          logs: [messagePassedLog],
          status: "0x1",
          transactionHash: messagePassedLog.transactionHash,
        },
      }),
      ok: true,
    }))
  );

  return {
    dgf,
    hub,
    hubs,
    networkStore,
    portal,
    reads,
    registry,
    walletStore,
  };
}

/**
 * DuskEVM's answers for a proof: the withdrawal's receipt, any block, and
 * the message passer's storage proof in it.
 */
function stubL2Proofs() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, request) => {
      const { method } = JSON.parse(request.body);
      const result =
        method === "eth_getBlockByNumber"
          ? {
              hash: `0x${"b1".repeat(32)}`,
              stateRoot: `0x${"b2".repeat(32)}`,
              timestamp: "0x1",
            }
          : method === "eth_getProof"
            ? {
                storageHash: `0x${"b3".repeat(32)}`,
                storageProof: [{ proof: [toRlp(["0x01"])] }],
              }
            : {
                blockHash: messagePassedLog.blockHash,
                blockNumber: messagePassedLog.blockNumber,
                logs: [messagePassedLog],
                status: "0x1",
                transactionHash: messagePassedLog.transactionHash,
              };

      return { json: async () => ({ result }), ok: true };
    })
  );
}
