import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import {
  forgetDepositActivity,
  rememberDepositTransaction,
  updateDepositTransaction,
} from "$lib/bridge/depositActivityStorage";
import { settingsStore } from "$lib/stores";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";
import { networks, routes } from "@dusk-network/networks";

import {
  rowOf,
  rowsOf,
  withBridge,
} from "$lib/activity/__tests__/fixtures/rows";
import { nameFacts } from "$lib/activity/activityHistory";
import {
  NOT_CONFIRMED_YET,
  describeRow,
  fullDateTime,
} from "$lib/activity/present";

import TransactionDetail from "../TransactionDetail.svelte";

// What the wallets here call a profile of another wallet's.
const { OWN } = vi.hoisted(() => ({
  OWN: "qxwSidLBa1rJ74ngfP4GUCaNsAYjMboDPHzbmiVEMmNNK26hVkYe8QccH6ipYdVRsUDnx9QS1KBeu8ZoMDFpXJJE6YCcHy2AykvJ7eEAGc7PGDgCZFV5YJBxzukADkQ2Bgr",
}));
const walletNames = new Map([[OWN, "Wallet 2 · Profile 1"]]);

vi.mock("$lib/wallets/accountNames", async () => {
  const { readable } = await import("svelte/store");

  return {
    default: readable(new Map([[OWN, "Wallet 2 · Profile 1"]])),
    // The profiles here, by name: no contact takes one's.
    profilesHere: readable([{ address: OWN, name: "Profile 1" }]),
  };
});

const BRIDGE = "ab".repeat(32);
const EVM = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const WITHDRAWAL = "0001".padEnd(64, "0");
const HASH = /** @type {`0x${string}`} */ (`0x${"8e".repeat(32)}`);

/** When the chain says the withdrawal can be claimed: Mon 2 Nov 2026, 03:20:39 UTC. */
const CLAIM_AT = Date.UTC(2026, 10, 2, 3, 20, 39);

/** @param {Record<string, unknown>} read */
const claims = (read) =>
  new Map([
    [
      HASH,
      {
        at: CLAIM_AT,
        claimed: false,
        exact: false,
        overdue: false,
        ready: false,
        reprove: false,
        ...read,
      },
    ],
  ]);
const context = { locale: "en", net: networks.testnet };

const DEFAULTS = {
  amount: "0",
  blockHeight: 4_687_000,
  contractId: BRIDGE,
  direction: "out",
  feePaid: "4419010",
  hash: "aa".repeat(32),
  kind: "contract_call",
  status: "executed",
  timestamp: Date.now() - 60_000,
};

/**
 * A row, by default a call to the bridge, final, on Testnet with the bridge
 * set for a local deployment.
 *
 * @param {Record<string, unknown>} fields
 * @param {Partial<import("@dusk-network/app-core/activity").ActivityInput>} [input]
 */
const row = (fields, input) =>
  rowOf(
    { ...DEFAULTS, ...fields },
    {
      nameCall: nameFacts,
      network: withBridge(networks.testnet, BRIDGE),
      ...input,
    },
  );

/**
 * @param {ActivityRow} shown
 * @param {Partial<import("$lib/activity/present").PresentContext>} [extra]
 */
const show = (shown, extra = {}, props = {}) =>
  render(TransactionDetail, {
    loadNonce: async () => null,
    locale: "en",
    presentation: describeRow(shown, { ...context, ...extra }),
    row: shown,
    ...props,
  });

/**
 * The text of the details' list, and of Technical details.
 *
 * @param {HTMLElement} container
 */
const mainList = (container) =>
  container.querySelector(".tx-detail__list:not(.tx-detail__list--tech)")
    ?.textContent ?? "";

/** @param {HTMLElement} container */
const techList = (container) =>
  container.querySelector(".tx-detail__list--tech")?.textContent ?? "";

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";
const SOZU_POOL =
  "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";

describe("TransactionDetail", () => {
  afterEach(() => {
    cleanup();
    setNodeNetwork(null);
  });

  it("should say which .dusk name a registration registered, with Dusk Domains' contract under Technical details only", () => {
    setNodeNetwork(networks.testnet);

    const { container } = show(
      row({
        amount: "10000000000",
        contractId: STORE,
        counterparty: STORE,
        fnName: "register",
        registeredName: "alice.dusk",
      }),
      {},
      { network: "testnet" },
    );

    expect(container.querySelector(".tx-detail__headline")).toHaveTextContent(
      "alice.dusk",
    );
    expect(mainList(container)).not.toContain(STORE);
    expect(mainList(container)).not.toContain("Dusk Domains");
    expect(techList(container)).toContain("Dusk Domains");
    expect(techList(container)).toContain(STORE);
  });

  it("should say to the lux the stDUSK a stake with Sozu got, and the rate, from the facts the export reads, with Sozu's contract under Technical details", async () => {
    const loadSozuFact = vi.fn(async () => ({
      amount: 500_000_000n,
      fee: 1_250_000n,
      kind: /** @type {const} */ ("stake"),
      pool: { stake: 8_142_876_697_294_578n, supply: 2_647_997_731_233_173n },
      stDusk: 162_189_471n,
    }));
    const stake = row({
      amount: "500000000",
      blockHeight: 4_692_418,
      contractId: SOZU_POOL,
      counterparty: SOZU_POOL,
      fnName: "sozu_stake",
      hash: "a4bd169fd983e4812c1844d19c749a8f8246ab4b3b5820fcf756ec8d244a6205",
    });
    const { container } = show(stake, {}, { loadSozuFact, network: "testnet" });

    await vi.waitFor(() =>
      expect(mainList(container)).toContain("0.162189471 stDUSK"),
    );
    // As the export says it: what one stDUSK was worth, to the lux.
    expect(mainList(container)).toContain("1 stDUSK = 3.075107127 DUSK");
    expect(loadSozuFact).toHaveBeenCalledExactlyOnceWith(stake);
    expect(mainList(container)).not.toContain(SOZU_POOL);
    expect(techList(container)).toContain("Sozu");
    expect(techList(container)).toContain(SOZU_POOL);
  });

  it("should say the stDUSK an unstake from Sozu gave back, and nothing of one that failed", async () => {
    const loadSozuFact = vi.fn(async () => ({
      amount: 200_000_000n,
      fee: 0n,
      kind: /** @type {const} */ ("unstake"),
      pool: { stake: 3_000_000_000n, supply: 1_000_000_000n },
      stDusk: 66_666_667n,
    }));
    const call = {
      blockHeight: 4_692_418,
      contractId: SOZU_POOL,
      counterparty: SOZU_POOL,
    };

    show(
      row({ ...call, fnName: "sozu_stake", status: "failed" }),
      {},
      { loadSozuFact },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadSozuFact).not.toHaveBeenCalled();
    cleanup();

    const { container } = show(
      row({ ...call, amount: "200000000", fnName: "sozu_unstake" }),
      {},
      { loadSozuFact },
    );

    await vi.waitFor(() =>
      expect(mainList(container)).toContain("0.066666667 stDUSK"),
    );
    expect(mainList(container)).toContain("1 stDUSK = 3 DUSK");
  });

  it("should name the DuskEVM address a deposit went to", () => {
    const { container } = show(
      row({
        amount: "100000000",
        bridge: { amount: "100000000", kind: "deposit", to: EVM },
        fnName: "depositETHToWithValue",
      }),
    );

    expect(container.textContent).toContain(EVM);
    // The bridge's contract only under Technical details.
    expect(mainList(container)).not.toContain(BRIDGE);
    expect(techList(container)).toContain(BRIDGE);
  });

  it("should show a proved withdrawal's amount and when it can be claimed, until it is claimed", () => {
    const proveCall = {
      bridge: {
        amount: "1008000000000",
        hash: HASH,
        kind: "prove",
        withdrawal: WITHDRAWAL,
      },
      fnName: "proveWithdrawalTransaction",
    };
    const proved = row(proveCall);
    /**
     * Its next step, as offered: none once it's claimed.
     *
     * @param {HTMLElement} shown
     */
    const nextStep = (shown) =>
      shown.querySelector(".tx-detail__next")?.closest("dd")?.textContent ??
      null;
    const { container } = show(proved, { claims: claims({}) });

    expect(
      container.querySelector(".tx-detail__amount")?.textContent,
    ).toContain("1,008");
    // When the chain says it can be claimed, in full.
    expect(nextStep(container)).toContain(fullDateTime(CLAIM_AT, "en"));

    cleanup();

    // Its proof's game blacklisted: no date, but that it must be proved again.
    expect(
      nextStep(
        show(proved, { claims: claims({ at: null, reprove: true }) }).container,
      ),
    ).not.toMatch(/\d{1,2}:\d{2}/);

    cleanup();

    // Until the chain has been read: no date made up from a fixed wait.
    expect(nextStep(show(proved).container)).not.toMatch(/\d{1,2}:\d{2}/);

    cleanup();

    // Claimed by a claim of the history.
    const [claimed] = rowsOf(
      [
        { ...DEFAULTS, ...proveCall },
        {
          ...DEFAULTS,
          bridge: { ...proveCall.bridge, kind: "claim" },
          fnName: "finalizeWithdrawalTransaction",
          hash: "bb".repeat(32),
        },
      ],
      { network: withBridge(networks.testnet, BRIDGE) },
    );
    expect(nextStep(show(claimed).container)).toBeNull();
  });

  it("should name the contract of a call that moved no DUSK, which has no counterparty", () => {
    const store =
      "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";

    setNodeNetwork(networks.testnet);

    const { container } = show(
      row({
        amount: "0",
        contractId: store,
        counterparty: null,
        fnName: "commit",
      }),
      {},
      { network: "testnet" },
    );

    expect(techList(container)).toContain("Dusk Domains");
    expect(container.textContent).toContain(store.slice(-6));
  });

  it("should name a profile of another wallet here as the wallets do, in its headline and its To, and never offer to save it as a contact", () => {
    const sent = row({
      amount: "10000000",
      contractId: undefined,
      kind: "transfer",
      to: OWN,
    });
    const { container, queryByRole } = show(sent, { walletNames });

    expect(container.querySelector(".tx-detail__headline")).toHaveTextContent(
      "Wallet 2 · Profile 1",
    );
    expect(mainList(container)).toMatch(/Wallet 2 · Profile 1\s*qxwSid/);
    expect(queryByRole("button", { name: "Save to contacts" })).toBeNull();
  });

  // Marek's: a send whose page died before the node answered read as sent.
  it("should say a send whose answer never came isn't confirmed yet, naming whom it's to, never that it was sent", () => {
    const unconfirmed = row({
      amount: "10000000",
      blockHeight: undefined,
      contractId: undefined,
      kind: "transfer",
      source: "local",
      status: "unknown",
      submittedAt: Date.now() - 60_000,
      timestamp: undefined,
      to: OWN,
    });
    const { container } = show(unconfirmed, { walletNames });

    expect(container.querySelector(".tx-detail__headline")).toHaveTextContent(
      "Wallet 2 · Profile 1",
    );
    expect(
      container.querySelector(".tx-detail__outcome--unknown"),
    ).toHaveTextContent(NOT_CONFIRMED_YET);
    expect(container).not.toHaveTextContent(/Sent to|Pending|Completed/);
  });

  it("should name a migration's payout by its route, with the route's account by what the network's file calls it, on any network", () => {
    // A network the wallet only knows from its node, as a local one.
    const local = /** @type {import("@dusk-network/networks").Network} */ ({
      ...networks.mainnet,
      chainId: 0,
      name: "local",
    });
    const [payouts] = routes(local).flatMap((route) =>
      route.kind === "migration" && route.payoutAccount
        ? [route.payoutAccount]
        : [],
    );
    const payout = row(
      {
        amount: "3500000000",
        contractId: undefined,
        counterparty: payouts,
        direction: "in",
        feePaid: undefined,
        from: payouts,
        kind: "transfer",
        memo: `0x${"c3".repeat(32)}`,
      },
      { network: local },
    );

    setNodeNetwork(local);

    const { container } = show(payout, { net: local }, { network: "Localnet" });

    expect(container.querySelector(".tx-detail__headline")).toHaveTextContent(
      "BNB Smart Chain",
    );
    expect(mainList(container)).toContain("BSC bridge");
  });

  it("should keep a failed transaction's error from reordering what's read: its contract can write anything", () => {
    const { container } = show({
      ...row({}),
      error: "refused \u202E0001\u202C",
    });

    expect(container.querySelector(".tx-detail__error")?.textContent).toContain(
      "refused \\u202e0001\\u202c",
    );
  });

  it("should give the fee paid to the last digit, in its list and under Technical details", () => {
    const { container } = show(row({ feePaid: "4419010" }));

    expect(mainList(container)).toContain("0.00441901 DUSK");
    expect(techList(container)).toContain("0.00441901 DUSK");
  });

  it("should say under Technical details the gas used of its limit", () => {
    const { container } = show(
      row({ gasLimit: "2500000", gasPrice: "1", gasSpent: "1853542" }),
    );

    expect(techList(container)).toContain("1,853,542");
    expect(techList(container)).toContain("2,500,000");
  });

  describe("a deposit to DuskEVM", () => {
    const DEPOSIT = "d0".repeat(32);
    const PAID = `0x${"02".repeat(31)}9e`;
    const deposited = row({
      amount: "100000000",
      bridge: { amount: "100000000", kind: "deposit", to: EVM },
      fnName: "depositETHToWithValue",
      hash: DEPOSIT,
    });

    afterEach(() => {
      forgetDepositActivity();
    });

    it("should follow it to DuskEVM, and say when it arrived there, and the transaction that paid it", async () => {
      const followDeposit = vi.fn();
      const ARRIVED = Date.UTC(2026, 9, 27, 5, 52, 13);

      setNodeNetwork(networks.testnet);

      const { container } = show(deposited, {}, { followDeposit });

      expect(followDeposit).toHaveBeenCalledExactlyOnceWith(deposited);
      expect(mainList(container)).not.toContain("Arrived");

      rememberDepositTransaction(DEPOSIT, {
        account: EVM,
        amountLux: "100000000",
      });
      updateDepositTransaction(DEPOSIT, {
        arrivedAt: ARRIVED,
        l2TransactionHash: /** @type {`0x${string}`} */ (PAID),
        stage: "completed",
      });

      await vi.waitFor(() =>
        expect(mainList(container)).toContain(fullDateTime(ARRIVED, "en")),
      );
      expect(mainList(container)).toContain("0x0202…029e");
    });

    it("should say nothing arrived while it's on its way", () => {
      rememberDepositTransaction(DEPOSIT, {
        account: EVM,
        amountLux: "100000000",
      });

      const { container } = show(deposited, {}, { followDeposit: vi.fn() });

      expect(mainList(container)).not.toContain("Arrived");
      expect(mainList(container)).not.toContain("DuskEVM transaction");
    });
  });

  it("should show the fee, and hide it with the balances, here and under Technical details", () => {
    const shown = show(row({ amount: "1000000000", feePaid: "1856398" }));

    expect(shown.container.textContent).toContain("0.001856398");
    cleanup();

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = show(
        row({ amount: "1000000000", feePaid: "1856398" }),
      );

      expect(mainList(container)).not.toBe("");
      expect(container.textContent).not.toContain("0.001856398");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should hide the gas used with the balances, as the fee can be worked out from it", async () => {
    const hiding = row({ gasLimit: "2500000", gasSpent: "1855255" });

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = show(hiding);

      expect(techList(container)).not.toBe("");
      expect(techList(container)).not.toContain("1,855,255");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should show a memo in the order it was written, its hidden characters as codes, and say so", () => {
    const { container, getByText } = show(
      row({ memo: "invoice \u202Egnp.exe\u202C" }),
    );

    expect(getByText("invoice \\u202egnp.exe\\u202c")).toBeInTheDocument();
    expect(container.querySelector(".memo-text__note")).not.toBeNull();

    cleanup();

    const plain = show(row({ memo: "Factura 33, abril" }));

    expect(plain.getByText("Factura 33, abril")).toBeInTheDocument();
    expect(plain.container.querySelector(".memo-text__note")).toBeNull();
  });

  it("should hide the stDUSK a stake got with the balances, not the rate, which says nothing of what's held", async () => {
    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = show(
        row({
          amount: "500000000",
          contractId: SOZU_POOL,
          counterparty: SOZU_POOL,
          fnName: "sozu_stake",
        }),
        {},
        {
          loadSozuFact: async () => ({
            amount: 500_000_000n,
            fee: 1_250_000n,
            kind: /** @type {const} */ ("stake"),
            pool: { stake: 3_000_000_000n, supply: 1_000_000_000n },
            stDusk: 162_189_471n,
          }),
          network: "testnet",
        },
      );

      await vi.waitFor(() =>
        expect(container.textContent).toContain("1 stDUSK = 3 DUSK"),
      );
      expect(container.textContent).not.toContain("0.1621");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should say which account sent it, and its gas price and nonce", async () => {
    const account = "2".repeat(60);
    const loadNonce = vi.fn(async () => "110");
    const { container, findByText, getByText } = show(
      row({
        amount: "1000000000",
        blockHash: "bb".repeat(32),
        contractId: undefined,
        gasLimit: "2500000",
        gasPrice: "1",
        gasSpent: "1856487",
        kind: "transfer",
        to: "3".repeat(60),
      }),
      {},
      {
        account: { address: account, label: "Profile 1 · wallet-both.dusk" },
        loadNonce,
      },
    );

    expect(mainList(container)).toContain("Profile 1 · wallet-both.dusk");
    expect(getByText("1 LUX")).toBeInTheDocument();
    expect(await findByText("110")).toBeInTheDocument();
    expect(loadNonce).toHaveBeenCalledWith("aa".repeat(32));
  });
});
