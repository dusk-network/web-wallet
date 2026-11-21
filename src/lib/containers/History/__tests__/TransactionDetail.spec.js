import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/svelte";

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
 * The text of the details' list.
 *
 * @param {HTMLElement} container
 */
const mainList = (container) =>
  container.querySelector(".tx-detail__list:not(.tx-detail__list--tech)")
    ?.textContent ?? "";

/**
 * A row's value, found by its label's key word, in the details' list or
 * under Technical details: null where there's no such row.
 *
 * @param {HTMLElement} container
 * @param {RegExp} label
 * @param {"main" | "tech"} [list]
 */
const field = (container, label, list = "main") =>
  Array.from(
    container.querySelectorAll(
      list === "tech"
        ? ".tx-detail__list--tech dt"
        : ".tx-detail__list:not(.tx-detail__list--tech) dt",
    ),
  ).find((term) => label.test(term.textContent ?? ""))?.nextElementSibling ??
  null;

/**
 * What an element says, its white space as one space: null for none.
 *
 * @param {Element | null | undefined} element
 */
const textOf = (element) =>
  element?.textContent?.replace(/\s+/g, " ").trim() ?? null;

const STORE =
  "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";
const SOZU_POOL =
  "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";

describe("TransactionDetail", () => {
  /** The time zone the tests were started in. */
  const zone = process.env.TZ;

  // Times as UTC gives them, whatever the device's zone, so that what's
  // said can be written out as it reads, before anything is formatted.
  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    if (zone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = zone;
    }
  });

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

    const contract = field(container, /contract/i, "tech");

    expect(textOf(container.querySelector(".tx-detail__headline"))).toMatch(
      /(?<![\w.-])alice\.dusk$/,
    );
    expect(mainList(container)).not.toContain(STORE);
    expect(mainList(container)).not.toContain("Dusk Domains");
    expect(textOf(contract?.querySelector(".tx-detail__name"))).toBe(
      "Dusk Domains",
    );
    expect(textOf(contract?.querySelector(".tx-detail__code"))).toBe(STORE);
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
      expect(textOf(field(container, /got/i))).toBe("0.162189471 stDUSK"),
    );
    // As the export says it: what one stDUSK was worth, to the lux.
    expect(textOf(field(container, /rate/i))).toBe(
      "1 stDUSK = 3.075107127 DUSK",
    );
    expect(loadSozuFact).toHaveBeenCalledExactlyOnceWith(stake);
    expect(mainList(container)).not.toContain(SOZU_POOL);

    const contract = field(container, /contract/i, "tech");

    expect(textOf(contract?.querySelector(".tx-detail__name"))).toBe(
      "Sozu pool",
    );
    expect(textOf(contract?.querySelector(".tx-detail__code"))).toBe(SOZU_POOL);
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
      expect(textOf(field(container, /gave back/i))).toBe("0.066666667 stDUSK"),
    );
    expect(textOf(field(container, /rate/i))).toBe("1 stDUSK = 3 DUSK");
  });

  it("should name the DuskEVM address a deposit went to, and copy it in full", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const { container } = show(
      row({
        amount: "100000000",
        bridge: { amount: "100000000", kind: "deposit", to: EVM },
        fnName: "depositETHToWithValue",
      }),
    );
    const to = /** @type {HTMLElement} */ (field(container, /^to$/i));

    expect(textOf(to.querySelector(".tx-detail__code"))).toBe(EVM);

    await fireEvent.click(within(to).getByRole("button", { name: /copy/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(EVM);
    // The bridge's contract only under Technical details.
    expect(mainList(container)).not.toContain(BRIDGE);
    expect(
      textOf(
        field(container, /contract/i, "tech")?.querySelector(
          ".tx-detail__code",
        ),
      ),
    ).toBe(BRIDGE);
  });

  it("should show a proved withdrawal's amount and its next step until it is claimed: when it can be claimed, ready to claim, or prove it again", () => {
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
     * Where it is, as its details say it.
     *
     * @param {HTMLElement} shown
     */
    const outcome = (shown) =>
      textOf(shown.querySelector(".tx-detail__outcome"));
    /**
     * Its next step, as offered: none once it's claimed.
     *
     * @param {HTMLElement} shown
     */
    const nextStep = (shown) =>
      textOf(shown.querySelector(".tx-detail__next")?.closest("dd"));
    const { container } = show(proved, { claims: claims({}) });

    expect(textOf(container.querySelector(".tx-detail__amount"))).toBe(
      "1,008 DUSK",
    );
    // Not claimed yet: when the chain says it can be, in full, as an
    // estimate until its game has resolved, never as an exact time.
    expect(outcome(container)).toMatch(/not claimed/i);
    expect(nextStep(container)).toMatch(
      /\babout Mon 2 Nov 2026, 3:20 AM UTC\b/,
    );
    expect(nextStep(container)).not.toMatch(
      /(?<!about )Mon 2 Nov 2026, 3:20 AM UTC/,
    );

    cleanup();

    // Its game resolved: that very time, no longer an estimate.
    const exact = show(proved, { claims: claims({ exact: true }) }).container;

    expect(nextStep(exact)).toMatch(/\bMon 2 Nov 2026, 3:20 AM UTC\b/);
    expect(nextStep(exact)).not.toMatch(/\babout\b/i);

    cleanup();

    // Ready: to claim now.
    const ready = show(proved, { claims: claims({ ready: true }) }).container;

    expect(outcome(ready)).toMatch(/ready to claim/i);
    expect(nextStep(ready)).toMatch(/ready to claim/i);

    cleanup();

    // Its proof's game blacklisted: that its proof was rejected, and to
    // prove it again; no claim offered, nor a date to claim from.
    const again = show(proved, {
      claims: claims({ at: null, reprove: true }),
    }).container;

    expect(outcome(again)).toMatch(/\brejected\b/i);
    expect(outcome(again)).toMatch(/prove it again/i);
    expect(nextStep(again)).toMatch(/\brejected\b/i);
    expect(nextStep(again)).toMatch(/prove it again/i);
    expect(nextStep(again)).not.toMatch(
      /claim from|ready to claim|claim it on/i,
    );
    expect(nextStep(again)).not.toMatch(/\d{1,2}:\d{2}/);

    cleanup();

    // Until the chain has been read: not claimed, and no date made up from
    // a fixed wait.
    const unread = show(proved).container;

    expect(outcome(unread)).toMatch(/not claimed/i);
    expect(nextStep(unread)).not.toMatch(/\d{1,2}:\d{2}/);

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
    const done = show(claimed).container;

    expect(outcome(done)).toMatch(/claimed/i);
    expect(outcome(done)).not.toMatch(
      /not claimed|ready to claim|prove it again/i,
    );
    expect(nextStep(done)).toBeNull();
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

    const contract = field(container, /contract/i, "tech");

    expect(textOf(contract?.querySelector(".tx-detail__name"))).toBe(
      "Dusk Domains",
    );
    expect(textOf(contract?.querySelector(".tx-detail__code"))).toBe(store);
  });

  it("should name a profile of another wallet here as the wallets do, in its To under a Sent headline, and never offer to save it as a contact", () => {
    const sent = row({
      amount: "10000000",
      contractId: undefined,
      kind: "transfer",
      to: OWN,
    });
    const { container, queryByRole } = show(sent, { walletNames });
    const to = field(container, /^to$/i);

    // What happened in the headline; whom it went to in the To under it.
    expect(textOf(container.querySelector(".tx-detail__headline"))).toBe(
      "Sent",
    );
    expect(textOf(to?.querySelector(".tx-detail__name"))).toBe(
      "Wallet 2 · Profile 1",
    );
    expect(textOf(to?.querySelector(".tx-detail__code"))).toBe(OWN);
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

    expect(textOf(container.querySelector(".tx-detail__headline"))).toMatch(
      /(?<![\w.-])Wallet 2 · Profile 1$/,
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

    expect(textOf(container.querySelector(".tx-detail__headline"))).toMatch(
      /BNB Smart Chain$/,
    );
    expect(
      textOf(field(container, /^from$/i)?.querySelector(".tx-detail__name")),
    ).toBe("BSC bridge");
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

  it("should give the fee paid to the last digit, in its list, once: Details doesn't repeat it", () => {
    const { container } = show(row({ feePaid: "4419010" }));

    expect(textOf(field(container, /^fee$/i))).toBe("0.00441901 DUSK");
    expect(field(container, /fee/i, "tech")).toBeNull();
  });

  it("should say under Technical details the gas used of its limit", () => {
    const { container } = show(
      row({ gasLimit: "2500000", gasPrice: "1", gasSpent: "1853542" }),
    );

    expect(textOf(field(container, /gas used/i, "tech"))).toMatch(
      /^1,853,542\D+2,500,000$/,
    );
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
      expect(field(container, /arrived/i)).toBeNull();

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
        expect(textOf(field(container, /arrived/i))).toBe(
          fullDateTime(ARRIVED, "en"),
        ),
      );
      expect(textOf(field(container, /duskevm/i)?.querySelector("a"))).toMatch(
        /^0x0202…029e(?![\w…])/,
      );
    });

    it("should say nothing arrived while it's on its way", () => {
      rememberDepositTransaction(DEPOSIT, {
        account: EVM,
        amountLux: "100000000",
      });

      const { container } = show(deposited, {}, { followDeposit: vi.fn() });

      expect(field(container, /arrived/i)).toBeNull();
      expect(field(container, /duskevm/i)).toBeNull();
    });
  });

  it("should show the fee once, and hide it with the balances", () => {
    const shown = show(row({ amount: "1000000000", feePaid: "1856398" }));

    expect(textOf(field(shown.container, /^fee$/i))).toBe("0.001856398 DUSK");
    expect(field(shown.container, /fee/i, "tech")).toBeNull();
    cleanup();

    settingsStore.update((store) => ({ ...store, hideBalances: true }));

    try {
      const { container } = show(
        row({ amount: "1000000000", feePaid: "1856398" }),
      );

      // Its row stays, without the figure.
      expect(field(container, /^fee$/i)).not.toBeNull();
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

      // Its row stays, without the figure.
      expect(field(container, /gas used/i, "tech")).not.toBeNull();
      expect(container.textContent).not.toContain("1,855,255");
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
        expect(textOf(field(container, /rate/i))).toBe("1 stDUSK = 3 DUSK"),
      );
      // Its row stays, without the figure.
      expect(field(container, /got/i)).not.toBeNull();
      expect(container.textContent).not.toContain("0.1621");
    } finally {
      settingsStore.update((store) => ({ ...store, hideBalances: false }));
    }
  });

  it("should say which account sent it, and its gas price and nonce", async () => {
    const account = "2".repeat(60);
    const loadNonce = vi.fn(async () => "110");
    const { container } = show(
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
    const from = field(container, /^from$/i);

    expect(textOf(from?.querySelector(".tx-detail__name"))).toMatch(
      /^Profile 1 · wallet-both\.dusk\b/,
    );
    expect(textOf(from?.querySelector(".tx-detail__code"))).toBe(account);
    expect(textOf(field(container, /gas price/i, "tech"))).toBe("1 LUX");
    await vi.waitFor(() =>
      expect(textOf(field(container, /nonce/i, "tech"))).toBe("110"),
    );
    expect(loadNonce).toHaveBeenCalledWith("aa".repeat(32));
  });

  it("should show a nonce only for the public, final row shown, never one from before", async () => {
    /** @type {Map<string, PromiseWithResolvers<string | null>>} */
    const lookups = new Map();
    const loadNonce = vi.fn((/** @type {string} */ hash) => {
      /** @type {PromiseWithResolvers<string | null>} */
      const lookup = Promise.withResolvers();

      lookups.set(hash, lookup);

      return lookup.promise;
    });
    const transfer = {
      blockHash: undefined,
      contractId: undefined,
      kind: /** @type {const} */ ("transfer"),
      to: "3".repeat(60),
    };
    const publicRow = row({ ...transfer, hash: "a1".repeat(32) });
    const shieldedRow = row({
      ...transfer,
      hash: "a2".repeat(32),
      source: "shielded",
    });
    const pending = row({
      ...transfer,
      hash: "a3".repeat(32),
      source: "local",
    });
    const shown = (/** @type {ActivityRow} */ next) => ({
      presentation: describeRow(next, context),
      row: next,
    });
    const { container, rerender } = show(publicRow, {}, { loadNonce });
    const answer = async (/** @type {string} */ hash, value = "110") => {
      lookups.get(hash)?.resolve(value);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    /** The nonce shown, under Technical details: null for none. */
    const nonce = () => textOf(field(container, /nonce/i, "tech"));

    await answer(publicRow.hash);

    expect(nonce()).toBe("110");

    // A shielded row has none: the one shown before goes.
    await rerender(shown(shieldedRow));

    expect(nonce()).toBeNull();

    // An answer that comes after its row was left is dropped.
    await rerender(shown(publicRow));
    await rerender(shown(pending));
    await answer(publicRow.hash, "111");

    expect(nonce()).toBeNull();
    expect(loadNonce).not.toHaveBeenCalledWith(pending.hash);

    // The same row, once final, is looked up.
    await rerender(shown(row({ ...transfer, hash: pending.hash })));
    await answer(pending.hash, "112");

    expect(nonce()).toBe("112");
  });
});
