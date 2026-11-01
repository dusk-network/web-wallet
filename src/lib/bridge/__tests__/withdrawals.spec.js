import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeFunctionData, parseAbi } from "viem";
import { networks } from "@dusk-network/networks";
import { duskRecipientOf, evmAddressOf } from "@dusk-network/networks/duskevm";
import { WithdrawalError } from "@dusk-network/app-core/duskevm-withdrawals";

import { WITHDRAWAL_GAS_REFUSAL } from "$lib/bridge/withdrawalLifecycle";
import { settingsStore } from "$lib/stores";

import { PAID } from "./fixtures/withdrawal-recipient";

/** What the package was made with, and what its withdrawals answer. */
const pkg = vi.hoisted(() => ({
  claimCall: vi.fn(),
  claims: vi.fn(),
  /** @type {any[]} */
  made: [],
  prepareProof: vi.fn(),
  status: vi.fn(),
  timing: vi.fn(),
}));

/** The wallet's account and its signer, which records and never signs. */
const wallet = vi.hoisted(() => ({
  forThisWallet: () => (/** @type {any} */ task) => task,
  getDuskEvmProofSubmitter: vi.fn(
    () => /** @type {`0x${string}`} */ (`0x${"97".repeat(20)}`)
  ),
  sendDuskEvmWithdrawalCall:
    /** @type {import("vitest").Mock<(call: any, gas: any) => Promise<{ hash: string }>>} */ (
      vi.fn(async () => ({ hash: "aa".repeat(32) }))
    ),
}));

const latest = vi.hoisted(() => ({
  getLatestBlock: vi.fn(async () => ({
    height: 4_727_899n,
    timestamp: 1_793_386_441n,
  })),
}));

vi.mock(
  "@dusk-network/app-core/duskevm-withdrawals",
  async (importOriginal) => ({
    .../** @type {object} */ (await importOriginal()),
    createWithdrawals: vi.fn((/** @type {any} */ options) => {
      pkg.made.push(options);

      return {
        claimCall: pkg.claimCall,
        claims: pkg.claims,
        prepareProof: pkg.prepareProof,
        status: pkg.status,
        timing: pkg.timing,
      };
    }),
  })
);

vi.mock("$lib/stores", async (importOriginal) => ({
  .../** @type {object} */ (await importOriginal()),
  networkStore: { connect: vi.fn(), getLatestBlock: latest.getLatestBlock },
  walletStore: wallet,
}));

const TX = /** @type {`0x${string}`} */ (`0x${"57".repeat(32)}`);
const SUBMITTER = `0x${"97".repeat(20)}`;
const PROXY = /** @type {`0x${string}`} */ (`0x${"6f".repeat(20)}`);
const PORTAL = networks.testnet.duskEvm?.contracts.optimism_portal.contractId;

/** A withdrawal's status as the package gives it. */
const STATUS = Object.freeze({
  blockNumber: 2_580_123n,
  facts: {
    amountWei: 10n ** 18n,
    recipient: { account: PAID, kind: "account" },
  },
  proofRejected: false,
  proofSubmitter: SUBMITTER,
  proofSubmitterCount: 0n,
  reason: null,
  stage: "ready_to_prove",
  transactionHash: TX,
  withdrawalHash: `0x${"8e".repeat(32)}`,
});

/** @param {Uint8Array} fnArgs @param {bigint} [gasLimit] */
const proofCall = (fnArgs, gasLimit = 51_000_000n) => ({
  args: [],
  contractId: PORTAL,
  decoded: { kind: "prove" },
  deposit: 0n,
  fnArgs,
  fnName: "proveWithdrawalTransaction",
  gasLimit,
});

/**
 * A proof as the package prepares it.
 *
 * @param {Uint8Array} fnArgs
 * @param {{ at: number, exact: boolean, overdue: boolean } | null} claim
 * @param {number} [at]
 */
const prepared = (fnArgs, claim, at = Date.now()) => ({
  at,
  call: proofCall(fnArgs),
  claim,
  proof: {},
  receipt: {},
});

const DATE = Object.freeze({
  at: 1_793_991_241_000,
  exact: true,
  overdue: false,
});

describe("DuskEVM withdrawals", () => {
  /** @type {typeof import("$lib/bridge/withdrawals")} */
  let withdrawals;

  /** @type {typeof import("$lib/stores/nodeNetwork").setNodeNetwork} */
  let setNodeNetwork;

  // Each test starts the module afresh: no package made, no proof kept.
  beforeEach(async () => {
    vi.resetModules();
    ({ setNodeNetwork } = await import("$lib/stores/nodeNetwork"));
    setNodeNetwork(networks.testnet);
    pkg.made.length = 0;

    for (const read of [
      pkg.claimCall,
      pkg.claims,
      pkg.prepareProof,
      pkg.status,
      pkg.timing,
    ]) {
      read.mockReset();
    }

    wallet.getDuskEvmProofSubmitter.mockClear();
    wallet.sendDuskEvmWithdrawalCall.mockClear();
    withdrawals = await import("$lib/bridge/withdrawals");
  });

  afterEach(() => {
    settingsStore.reset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("the settings", () => {
    it("take the Portal, the dispute game factory and their drivers from the node's network", async () => {
      const contracts = networks.testnet.duskEvm?.contracts;

      expect(withdrawals.getWithdrawalFinalizationConfig()).toMatchObject({
        configured: true,
        disputeGameFactoryContractId:
          contracts?.dispute_game_factory.contractId,
        disputeGameFactoryDataDriverUrl:
          "/drivers/dispute_game_factory_dd_opt.wasm",
        missing: [],
        optimismPortalContractId: contracts?.optimism_portal.contractId,
        optimismPortalDataDriverUrl: "/drivers/optimism_portal_dd_opt.wasm",
      });

      // A network without DuskEVM has none, unless set.
      setNodeNetwork(networks.mainnet);

      expect(withdrawals.getWithdrawalFinalizationConfig()).toMatchObject({
        configured: false,
        optimismPortalContractId: "",
      });
      await expect(withdrawals.loadWithdrawalStatus(TX)).rejects.toThrow(
        "DuskEVM withdrawal finalization is not configured"
      );
    });

    it("take relative and http data-driver URLs, and no other", () => {
      vi.stubEnv("VITE_EVM_OPTIMISM_PORTAL_CONTRACT_ID", "11".repeat(32));
      vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", "22".repeat(32));
      vi.stubEnv(
        "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
        "/drivers/portal.wasm"
      );
      vi.stubEnv(
        "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
        "https://assets.example.test/dgf.wasm"
      );

      expect(withdrawals.getWithdrawalFinalizationConfig()).toMatchObject({
        configured: true,
        missing: [],
      });

      vi.stubEnv(
        "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
        "file:///tmp/portal.wasm"
      );
      vi.stubEnv(
        "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
        "data:application/wasm;base64,AA=="
      );

      expect(withdrawals.getWithdrawalFinalizationConfig()).toMatchObject({
        configured: false,
        missing: [
          "VITE_EVM_OPTIMISM_PORTAL_DATA_DRIVER_URL",
          "VITE_EVM_DISPUTE_GAME_FACTORY_DATA_DRIVER_URL",
        ],
      });
    });

    it.each([
      ["the network's by default", networks.testnet, "", "1735498c"],
      ["the one set", networks.testnet, `0x${"ab".repeat(32)}`, "abababab"],
      ["none with `none`", networks.testnet, "none", ""],
      [
        "none on a network without DuskEVM, unless set",
        networks.mainnet,
        "",
        "",
      ],
    ])(
      "know the anchor state registry the Portal asks: %s",
      (_what, net, set, starts) => {
        setNodeNetwork(net);
        vi.stubEnv("VITE_EVM_ANCHOR_STATE_REGISTRY_CONTRACT_ID", set);

        const id =
          withdrawals.getWithdrawalFinalizationConfig()
            .anchorStateRegistryContractId;

        expect(id.slice(0, 8)).toBe(starts);
        expect(id).toMatch(starts ? /^[0-9a-f]{64}$/u : /^$/u);
      }
    );
  });

  describe("the reads", () => {
    it("go to the node through its Multicall for Dusk batcher, with the bundled drivers, and to DuskEVM's RPC, one package a network", async () => {
      vi.stubEnv("VITE_NODE_URL", "https://nodes.example.test");
      vi.stubEnv("VITE_EVM_BRIDGE_GAME_SEARCH_DEPTH", "32");
      pkg.status.mockResolvedValue(STATUS);

      await withdrawals.loadWithdrawalStatus(TX);
      await withdrawals.loadWithdrawalStatus(TX, { proofGame: PROXY });

      expect(pkg.made).toHaveLength(1);

      const [options] = pkg.made;

      expect(options).toMatchObject({
        duskEvm: { url: networks.testnet.duskEvm?.rpcUrl },
        fetch: expect.any(Function),
        gameSearchDepth: 32,
        maxBatch: 32,
        nodeUrl: "https://nodes.example.test",
      });
      // The network's file, as nothing is set in its place.
      expect(options.network).toBe(networks.testnet);
      // For the account that proves and claims: the wallet's.
      expect(pkg.status).toHaveBeenLastCalledWith(TX, {
        proofGame: PROXY,
        submitter: SUBMITTER,
      });
      // Contract times count from the latest block the wallet reads.
      await expect(options.latestBlock()).resolves.toStrictEqual({
        height: 4_727_899n,
        timestamp: 1_793_386_441n,
      });

      // The drivers served with the wallet, pinned by the network's file.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (/** @type {string} */ url) => {
          expect(url).toMatch(/^\/drivers\/[a-z_]+\.wasm$/u);

          return new Response(readFileSync(resolve(`static${url}`)));
        })
      );

      const [portal, factory] = await Promise.all([
        options.drivers.optimismPortal(),
        options.drivers.disputeGameFactory(),
      ]);

      expect(portal.encodeInputFn).toBeTypeOf("function");
      expect(factory.decodeOutputFn).toBeTypeOf("function");
    });

    it("take the contracts and the bridge set for local work in place of the network's", async () => {
      vi.stubEnv("VITE_EVM_DISPUTE_GAME_FACTORY_CONTRACT_ID", "22".repeat(32));
      vi.stubEnv("VITE_EVM_ANCHOR_STATE_REGISTRY_CONTRACT_ID", "none");
      vi.stubEnv("VITE_EVM_BRIDGE_CONTRACT_ADDRESS", `0x${"42".repeat(20)}`);
      pkg.status.mockResolvedValue(STATUS);

      await withdrawals.loadWithdrawalStatus(TX);

      const { contracts, predeploys } = pkg.made[0].network.duskEvm;

      expect(contracts.dispute_game_factory.contractId).toBe("22".repeat(32));
      expect(contracts.optimism_portal).toStrictEqual(
        networks.testnet.duskEvm?.contracts.optimism_portal
      );
      expect(contracts).not.toHaveProperty("anchor_state_registry");
      expect(predeploys).toStrictEqual({
        ...networks.testnet.duskEvm?.predeploys,
        l2StandardBridge: `0x${"42".repeat(20)}`,
      });
      // A start goes to the bridge its withdrawal is checked against.
      expect(
        withdrawals.withdrawalStart({
          amountWei: 10n ** 9n,
          sender: `0x${"22".repeat(20)}`,
          to: PAID,
        }).to
      ).toBe(`0x${"42".repeat(20)}`);
    });

    it("check a withdrawal's relay against the bridge on Dusk set for local work", async () => {
      vi.stubEnv("VITE_BRIDGE_CONTRACT_ID", "33".repeat(32));
      pkg.status.mockResolvedValue(STATUS);

      await withdrawals.loadWithdrawalStatus(TX);

      expect(
        pkg.made[0].network.duskEvm.contracts.l1_standard_bridge
      ).toStrictEqual({
        contractId: "33".repeat(32),
        evmAddress: evmAddressOf("33".repeat(32)),
      });
    });
  });

  describe("a status", () => {
    it.each([
      [
        "waiting_for_output",
        "no-games",
        "No dispute games have been proposed yet.",
      ],
      [
        "waiting_for_output",
        "no-output",
        "No finalized output proposal covering this withdrawal is ready yet.",
      ],
      ["ready_to_prove", null, undefined],
      [
        "ready_to_prove",
        "proof-rejected",
        "The existing proof is not accepted by the portal, and a newer output proposal is available. Prove the withdrawal again.",
      ],
      [
        "proven_waiting",
        "game-in-progress",
        "The proof is accepted. Its dispute game is still in progress.",
      ],
      [
        "proven_waiting",
        "game-not-final",
        "The proof is accepted. Wait for its dispute game to become final.",
      ],
      [
        "proven_waiting",
        "game-unreadable",
        "The proof is accepted, but its dispute game can't be read right now.",
      ],
      [
        "proven_waiting",
        "portal-refuses",
        "The Portal doesn't take the claim yet.",
      ],
      [
        "proven_waiting",
        "proof-rejected",
        "The existing proof was rejected, but no replacement output proposal is available yet.",
      ],
      ["ready_to_finalize", null, ""],
      ["finalized", null, undefined],
    ])(
      "at %s for %s says why in the wallet's words",
      async (stage, reason, words) => {
        pkg.status.mockResolvedValue({ ...STATUS, reason, stage });

        expect((await withdrawals.loadWithdrawalStatus(TX)).statusMessage).toBe(
          words
        );
      }
    );

    it("says a read that failed while a game was looked for as it failed", async () => {
      pkg.status.mockResolvedValue({
        ...STATUS,
        error: new Error("eth_getProof failed with HTTP 503"),
        reason: "no-output",
        stage: "waiting_for_output",
      });

      expect((await withdrawals.loadWithdrawalStatus(TX)).statusMessage).toBe(
        "eth_getProof failed with HTTP 503"
      );
    });

    it("names the proof submitter once someone proved it and until it's claimed, and a rejected proof only once this account proved", async () => {
      pkg.status.mockResolvedValue(STATUS);

      expect(await withdrawals.loadWithdrawalStatus(TX)).toMatchObject({
        proofRejected: undefined,
        proofSubmitter: undefined,
      });

      pkg.status.mockResolvedValue({ ...STATUS, proofSubmitterCount: 1n });

      expect(await withdrawals.loadWithdrawalStatus(TX)).toMatchObject({
        proofRejected: undefined,
        proofSubmitter: SUBMITTER,
      });

      pkg.status.mockResolvedValue({
        ...STATUS,
        disputeGameProxy: PROXY,
        proofRejected: true,
        proofSubmitterCount: 1n,
        reason: "proof-rejected",
        stage: "proven_waiting",
      });

      expect(await withdrawals.loadWithdrawalStatus(TX)).toMatchObject({
        disputeGameProxy: PROXY,
        proofRejected: true,
        proofSubmitter: SUBMITTER,
      });

      // A claim's status says no more of who proved it.
      pkg.status.mockResolvedValue({
        ...STATUS,
        proofSubmitterCount: 1n,
        stage: "finalized",
      });

      expect(await withdrawals.loadWithdrawalStatus(TX)).toMatchObject({
        proofRejected: undefined,
        proofSubmitter: undefined,
      });
    });

    it.each([
      ["not-found", "Withdrawal transaction was not found."],
      ["failed", "Withdrawal transaction failed on DuskEVM."],
    ])(
      "says a withdrawal %s on DuskEVM as the tracking reads it",
      async (code, words) => {
        pkg.status.mockRejectedValue(
          new WithdrawalError(/** @type {any} */ (code))
        );

        await expect(withdrawals.loadWithdrawalStatus(TX)).rejects.toThrow(
          new Error(words)
        );
      }
    );

    it("is read only for a DuskEVM transaction hash", async () => {
      await expect(
        withdrawals.loadWithdrawalStatus(
          /** @type {`0x${string}`} */ ("0x1234")
        )
      ).rejects.toThrow("Enter a valid DuskEVM withdrawal transaction hash.");
      expect(pkg.status).not.toHaveBeenCalled();
    });
  });

  describe("proving", () => {
    it("sends the proof whose claim date was shown, for two minutes, as the package built it", async () => {
      const shown = Uint8Array.of(1, 2, 3);

      pkg.prepareProof.mockResolvedValueOnce(prepared(shown, DATE));

      await expect(withdrawals.loadProveNowClaim(TX)).resolves.toStrictEqual(
        DATE
      );
      await expect(withdrawals.proveWithdrawal(TX)).resolves.toBe(
        "aa".repeat(32)
      );

      expect(pkg.prepareProof).toHaveBeenCalledExactlyOnceWith(TX, {
        gasLimitUpper: 1_000_000_000n,
        submitter: SUBMITTER,
      });
      expect(wallet.sendDuskEvmWithdrawalCall).toHaveBeenCalledExactlyOnceWith(
        proofCall(shown),
        expect.objectContaining({ limit: 51_000_000n, price: 1n })
      );
      // The arguments as the package encoded and read them back.
      expect(wallet.sendDuskEvmWithdrawalCall.mock.calls[0][0].fnArgs).toBe(
        shown
      );
    });

    it("makes the proof again once the one shown is two minutes old, and sends a proof once", async () => {
      const old = Uint8Array.of(1);
      const fresh = Uint8Array.of(2);

      pkg.prepareProof
        .mockResolvedValueOnce(
          prepared(old, DATE, Date.now() - withdrawals.PREPARED_PROOF_MS)
        )
        .mockResolvedValueOnce(prepared(fresh, DATE))
        .mockResolvedValueOnce(prepared(old, DATE));

      await withdrawals.loadProveNowClaim(TX);
      await withdrawals.proveWithdrawal(TX);
      await withdrawals.proveWithdrawal(TX);

      expect(pkg.prepareProof).toHaveBeenCalledTimes(3);
      expect(
        wallet.sendDuskEvmWithdrawalCall.mock.calls.map(([call]) => call.fnArgs)
      ).toStrictEqual([fresh, old]);
    });

    it("keeps sending the proof whose date is shown when a newer one has no date", async () => {
      const shown = Uint8Array.of(1);

      pkg.prepareProof
        .mockResolvedValueOnce(prepared(shown, DATE))
        .mockResolvedValueOnce(prepared(Uint8Array.of(2), null));

      await withdrawals.loadProveNowClaim(TX);
      await expect(withdrawals.loadProveNowClaim(TX)).resolves.toBeNull();
      await withdrawals.proveWithdrawal(TX);

      expect(wallet.sendDuskEvmWithdrawalCall.mock.calls[0][0].fnArgs).toBe(
        shown
      );
    });

    it("sends nothing the package refuses, and says a gas refusal in the wallet's words", async () => {
      pkg.prepareProof.mockRejectedValue(new WithdrawalError("gas"));

      await expect(withdrawals.proveWithdrawal(TX)).rejects.toThrow(
        WITHDRAWAL_GAS_REFUSAL
      );

      pkg.prepareProof.mockRejectedValue(
        new WithdrawalError("no-proof", undefined, { reason: "no-games" })
      );

      await expect(withdrawals.proveWithdrawal(TX)).rejects.toThrow(
        "No dispute games have been proposed yet."
      );
      expect(wallet.sendDuskEvmWithdrawalCall).not.toHaveBeenCalled();
    });
  });

  describe("claiming", () => {
    const claimCall = Object.freeze({
      args: {},
      contractId: PORTAL,
      decoded: { kind: "claim" },
      deposit: 0n,
      fnArgs: Uint8Array.of(9),
      fnName: "finalizeWithdrawalTransaction",
      gasLimit: 51_500_000n,
    });

    it("sends the claim the package hands over, for the wallet's account, at the gas price set", async () => {
      pkg.claimCall.mockResolvedValue(claimCall);
      settingsStore.update((settings) => ({ ...settings, customGasPrice: 7n }));

      await expect(withdrawals.finalizeWithdrawal(TX)).resolves.toBe(
        "aa".repeat(32)
      );

      expect(pkg.claimCall).toHaveBeenCalledExactlyOnceWith(TX, {
        gasLimitUpper: 1_000_000_000n,
        submitter: SUBMITTER,
      });
      expect(wallet.sendDuskEvmWithdrawalCall).toHaveBeenCalledExactlyOnceWith(
        claimCall,
        expect.objectContaining({ limit: 51_500_000n, price: 7n })
      );
    });

    it.each([
      [
        { ...STATUS, proofSubmitterCount: 0n, stage: "ready_to_prove" },
        "The withdrawal must be proven before it can be finalized.",
      ],
      [
        {
          ...STATUS,
          disputeGameProxy: PROXY,
          proofSubmitterCount: 1n,
          reason: "game-in-progress",
          stage: "proven_waiting",
        },
        "The proof is accepted. Its dispute game is still in progress.",
      ],
      [
        { ...STATUS, stage: "finalized" },
        "The withdrawal is already finalized.",
      ],
    ])(
      "sends no claim that isn't ready, and says why in the wallet's words",
      async (status, words) => {
        pkg.claimCall.mockRejectedValue(
          new WithdrawalError("not-ready", undefined, {
            status: /** @type {any} */ (status),
          })
        );

        await expect(withdrawals.finalizeWithdrawal(TX)).rejects.toThrow(words);
        expect(wallet.sendDuskEvmWithdrawalCall).not.toHaveBeenCalled();
      }
    );
  });

  it("starts a withdrawal on DuskEVM's bridge, paying the Dusk account given", () => {
    const sender = "0x2222222222222222222222222222222222222222";
    const start = withdrawals.withdrawalStart({
      amountWei: 10n ** 18n,
      sender,
      to: PAID,
    });
    const { args, functionName } = decodeFunctionData({
      abi: parseAbi(["function bridgeETHTo(address, uint32, bytes)"]),
      data: start.data,
    });

    expect(start).toMatchObject({
      to: networks.testnet.duskEvm?.predeploys.l2StandardBridge,
      value: 10n ** 18n,
    });
    expect(functionName).toBe("bridgeETHTo");
    expect(args.slice(0, 2)).toStrictEqual([sender, 200_000]);
    expect(duskRecipientOf(args[2])).toStrictEqual({
      account: PAID,
      kind: "account",
    });
  });

  it("reads a submitted Dusk transaction's execution from the node", async () => {
    const { networkStore } = await import("$lib/stores");
    const query = vi.fn().mockResolvedValue({
      tx: { blockHeight: 14_002, err: "contract execution failed" },
    });

    vi.mocked(networkStore.connect).mockResolvedValue(
      /** @type {any} */ ({ query })
    );

    await expect(
      withdrawals.loadDuskTransactionExecution(`0x${"AB".repeat(32)}`)
    ).resolves.toStrictEqual({
      blockHeight: 14_002n,
      error: "contract execution failed",
    });
    expect(query).toHaveBeenCalledWith(
      `tx(hash: "${"ab".repeat(32)}") { err blockHeight }`
    );
    await expect(
      withdrawals.loadDuskTransactionExecution("not-a-hash")
    ).rejects.toThrow("Dusk transaction hash is invalid.");
  });
});
