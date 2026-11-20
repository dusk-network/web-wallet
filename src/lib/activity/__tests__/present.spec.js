import { describe, expect, it } from "vitest";
import { networks, routes } from "@dusk-network/networks";

import { claimDay } from "$lib/bridge/claimDate";
import { setNodeNetwork } from "$lib/stores/nodeNetwork";

import { nameFacts } from "../activityHistory";
import {
  NOT_CONFIRMED_YET,
  describeRow,
  matchesFilters,
  routeLabel,
} from "../present";
import { rowOf, rowsOf, withBridge } from "./fixtures/rows";

const ACCOUNT =
  "26JfWKvhYdVY71bdSPVLNJ51Buy4GjimCT7zcsoxNQtydDbdoH2AwZaH8W7rjcAc9riAu39Vw9Lx1w7yrkBgotSjWmUdkSyQuaTKDZWVCKp9g1GxiEnnksv3W3onToB5NsNi";
const BRIDGE = "ab".repeat(32);
const context = { locale: "en" };

const bridged = withBridge(networks.testnet, BRIDGE);

/**
 * A figure on its own, never part of a longer one: "0.0037 DUSK" never as
 * part of "10.0037 DUSK".
 *
 * @param {string} text
 */
const figure = (text) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(`(?<![\\d.,])${escaped}(?![\\d])`);
};

const DEFAULTS = {
  amount: "25000000000",
  blockHeight: 4_687_000,
  direction: "out",
  hash: "aa".repeat(32),
  kind: "transfer",
  privacy: "public",
  status: "executed",
  timestamp: Date.UTC(2026, 9, 26, 13, 32),
  to: ACCOUNT,
};

/**
 * A row, by default a public transfer sent, final, on Testnet.
 *
 * @param {Record<string, any>} fields
 * @param {Partial<import("@dusk-network/app-core/activity").ActivityInput>} [input]
 */
const row = (fields, input) =>
  rowOf({ ...DEFAULTS, ...fields }, { network: bridged, ...input });

describe("describeRow", () => {
  it("names a counterparty saved as a contact by the contact's name, its .dusk name second", () => {
    const contactNames = new Map([[ACCOUNT, "Alice"]]);

    expect(
      describeRow(row({ counterpartyName: "alice-shop.dusk" }), {
        ...context,
        contactNames,
      }),
    ).toMatchObject({
      title: "Alice · alice-shop.dusk",
      titleIsAddress: false,
    });
    expect(describeRow(row({}), { ...context, contactNames }).title).toBe(
      "Alice",
    );
    expect(
      describeRow(row({ direction: "in", from: ACCOUNT, to: undefined }), {
        ...context,
        contactNames,
      }).title,
    ).toBe("Alice");
  });

  it("names a profile of a wallet kept here as the wallets do, after a contact or a .dusk name", () => {
    const walletNames = new Map([[ACCOUNT, "Wallet 2 · Profile 1"]]);

    expect(describeRow(row({}), { ...context, walletNames })).toMatchObject({
      title: "Wallet 2 · Profile 1",
      titleIsAddress: false,
    });
    expect(
      describeRow(row({ direction: "in", from: ACCOUNT, to: undefined }), {
        ...context,
        walletNames,
      }).title,
    ).toBe("Wallet 2 · Profile 1");
    expect(
      describeRow(row({ counterpartyName: "alice-shop.dusk" }), {
        ...context,
        walletNames,
      }).title,
    ).toBe("alice-shop.dusk");
    expect(
      describeRow(row({}), {
        ...context,
        contactNames: new Map([[ACCOUNT, "Alice"]]),
        walletNames,
      }).title,
    ).toBe("Alice");
  });

  it("shows an amount in the one format, and in full for a hover", () => {
    expect(
      describeRow(row({ amount: "1234567891234" }), context).amount,
    ).toMatchObject({ exact: "1,234.567891234", text: "1,234.5678" });
  });

  it("names a transfer by its counterparty's verified name, or its short address", () => {
    expect(
      describeRow(row({ counterpartyName: "alice-shop.dusk" }), context),
    ).toMatchObject({
      amount: { exact: "25", muted: false, sign: "−", text: "25" },
      category: "sent",
      icon: "sent",
      privacy: "Public",
      status: null,
      title: "alice-shop.dusk",
      titleIsAddress: false,
    });
    expect(describeRow(row({}), context)).toMatchObject({
      title: `${ACCOUNT.slice(0, 6)}…${ACCOUNT.slice(-6)}`,
      titleIsAddress: true,
    });
    expect(
      describeRow(
        row({ direction: "in", from: ACCOUNT, to: undefined }),
        context,
      ),
    ).toMatchObject({
      amount: { sign: "+" },
      category: "received",
      icon: "received",
    });
  });

  it("shows a failed transaction moved nothing: no sign, muted, and the fee it cost", () => {
    expect(
      describeRow(row({ feePaid: "3700000", status: "failed" }), context),
    ).toMatchObject({
      amount: { muted: true, sign: "" },
      line: expect.stringMatching(figure("0.0037 DUSK")),
      status: "failed",
    });

    // A fee paid rounds to the nearest of four decimals.
    expect(
      describeRow(row({ feePaid: "1853542", status: "failed" }), context).line,
    ).toMatch(figure("0.0019 DUSK"));

    // None paid: none said.
    const unpaid = describeRow(
      row({ source: "local", status: "failed" }),
      context,
    );

    expect(unpaid.amount).toMatchObject({ muted: true, sign: "", text: "25" });
    expect(unpaid.line).not.toMatch(/\d DUSK/);
  });

  it("shows a status only while a transaction isn't final", () => {
    expect(
      describeRow(row({ source: "local", status: "submitted" }), context)
        .status,
    ).toBe("pending");
    expect(
      describeRow(row({ source: "local", status: "unknown" }), context).status,
    ).toBe("unknown");

    // An archive entry is final: only its outcome isn't looked up yet.
    expect(
      describeRow(row({ status: "unknown", success: null }), context).status,
    ).toBeNull();
  });

  // Marek's: a send whose page died before the node answered read "Sent ·
  // Pending" though the chain never saw it.
  it("says a send whose answer never came isn't confirmed yet, never Sent", () => {
    const unconfirmed = describeRow(
      row({ direction: "out", source: "local", status: "unknown" }),
      context,
    );

    expect(unconfirmed).toMatchObject({
      line: NOT_CONFIRMED_YET,
      shortLine: NOT_CONFIRMED_YET,
      status: "unknown",
    });
    expect(
      describeRow(
        row({ direction: "out", source: "local", status: "submitted" }),
        context,
      ).line,
    ).not.toBe(NOT_CONFIRMED_YET);
  });

  it("names staking, shielding and the bridge by what they did", () => {
    expect(describeRow(row({ kind: "stake" }), context).category).toBe(
      "staking",
    );
    expect(
      describeRow(row({ direction: "in", kind: "withdraw_reward" }), context)
        .category,
    ).toBe("staking");
    expect(describeRow(row({ kind: "shield" }), context).amount.sign).toBe("");
    expect(
      describeRow(
        row({ contractId: BRIDGE, kind: "contract_call", to: undefined }),
        context,
      ),
    ).toMatchObject({
      amount: { sign: "−" },
      category: "bridge",
      title: expect.stringContaining("DuskEVM"),
    });
    // A withdrawal's proof moved nothing but its fee.
    expect(
      describeRow(
        row({
          amount: "0",
          contractId: BRIDGE,
          fnName: "proveWithdrawalTransaction",
          kind: "contract_call",
        }),
        context,
      ),
    ).toMatchObject({ amount: { sign: "" }, category: "bridge" });
    // Paid by the bridge; a gas refund another account's call to it paid
    // here is a transfer from that account.
    expect(
      describeRow(
        row({
          contractId: BRIDGE,
          direction: "in",
          from: BRIDGE,
          kind: "contract_call",
          to: undefined,
        }),
        context,
      ),
    ).toMatchObject({
      amount: { sign: "+" },
      category: "bridge",
      title: expect.stringContaining("DuskEVM"),
    });
    expect(
      describeRow(
        row({
          contractId: BRIDGE,
          direction: "in",
          from: ACCOUNT,
          kind: "contract_call",
          to: undefined,
        }),
        context,
      ),
    ).toMatchObject({ category: "received", title: "26JfWK…B5NsNi" });
  });

  it("names a call to Dusk Domains by what it did", () => {
    const store =
      "4e2de1ed4f1fd53de83f4809a75367301c7645a546030fa199aff804e6854199";
    const call = {
      amount: "10000000000",
      contractId: store,
      fnName: "register",
      kind: "contract_call",
      to: undefined,
    };
    const named = { nameCall: nameFacts };

    setNodeNetwork(networks.testnet);

    try {
      expect(describeRow(row(call, named), context)).toMatchObject({
        amount: { sign: "−", text: "10" },
        icon: "call",
        line: "Dusk Domains",
      });

      // Once the history has read which name it registered: that name.
      expect(
        describeRow(
          row({ ...call, registeredName: "alice.dusk" }, named),
          context,
        ),
      ).toMatchObject({
        line: "Dusk Domains",
        title: expect.stringMatching(/registered.*(?<![\w.-])alice\.dusk$/i),
      });

      // A reservation: the first of two steps, until a registration after
      // it reveals which name it was for.
      const reservation = {
        ...DEFAULTS,
        amount: "0",
        contractId: store,
        fnName: "commit",
        kind: "contract_call",
        nameCommit: { kind: "reservation", reservation: "c0".repeat(32) },
        to: undefined,
      };
      const [registered, reserved] = rowsOf(
        [
          reservation,
          {
            ...DEFAULTS,
            ...call,
            blockHeight: 4_687_010,
            hash: "bb".repeat(32),
            nameCommit: { kind: "registration", reservation: "c0".repeat(32) },
            registeredName: "alice.dusk",
          },
        ],
        named,
      );

      expect(describeRow(registered, context).title).toMatch(
        /registered.*(?<![\w.-])alice\.dusk$/i,
      );
      expect(describeRow(reserved, context).title).toMatch(
        /reserved.*(?<![\w.-])alice\.dusk$/i,
      );

      // On Mainnet, the same contract is no one's: any call.
      setNodeNetwork(networks.mainnet);

      const anyCall = describeRow(row(call, named), context);

      expect(anyCall).toMatchObject({
        icon: "call",
        line: expect.stringMatching(/contract/i),
        title: expect.stringMatching(/called register/i),
      });
    } finally {
      setNodeNetwork(null);
    }
  });

  it("says where a bridge row's DUSK went: the DuskEVM address, or the withdrawal and its next step", () => {
    const evm = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
    const withdrawal = "0001".padEnd(64, "0");
    const hash = /** @type {`0x${string}`} */ (`0x${"8e".repeat(32)}`);
    const prove = {
      amount: "0",
      bridge: { amount: "1008000000000", hash, kind: "prove", withdrawal },
      contractId: BRIDGE,
      fnName: "proveWithdrawalTransaction",
      kind: "contract_call",
      to: undefined,
    };
    const finalize = {
      ...prove,
      bridge: { ...prove.bridge, kind: "claim" },
      fnName: "finalizeWithdrawalTransaction",
      hash: "bb".repeat(32),
    };
    const proved = row(prove);
    // When the chain says it can be claimed: Mon 2 Nov 2026, 03:20:39 UTC.
    const at = Date.UTC(2026, 10, 2, 3, 20, 39);
    const day = claimDay(at, "en");
    /** @param {Record<string, unknown>} read */
    const claims = (read) =>
      new Map([
        [
          hash,
          {
            at,
            claimed: false,
            exact: false,
            overdue: false,
            ready: false,
            reprove: false,
            ...read,
          },
        ],
      ]);

    expect(
      describeRow(
        row({
          bridge: { amount: "25000000000", kind: "deposit", to: evm },
          contractId: BRIDGE,
          kind: "contract_call",
          to: undefined,
        }),
        context,
      ),
    ).toMatchObject({
      amount: { sign: "−", text: "25" },
      counterparty: evm,
      line: expect.stringContaining("0x19E7…ff2A"),
      note: null,
    });

    // Proved, not claimed: the amount on its way, muted. No date is made up
    // from a fixed wait: none until the chain has been read.
    expect(describeRow(proved, context)).toMatchObject({
      amount: { muted: true, sign: "", text: "1,008" },
      note: null,
      withdrawal: { claim: null, claimed: false, ready: false },
    });

    // Then when it can be claimed, as the chain says: about, until its
    // game has resolved.
    const waiting = describeRow(proved, { ...context, claims: claims({}) });

    expect(waiting).toMatchObject({
      line: expect.stringContaining(day),
      withdrawal: { claim: { at, exact: false, overdue: false } },
    });
    // Where a row is narrow, the claim date gets a line of its own.
    expect(waiting.note).toContain(day);
    expect(
      describeRow(proved, { ...context, claims: claims({ exact: true }) }),
    ).toMatchObject({
      line: expect.stringContaining(day),
      withdrawal: { claim: { exact: true } },
    });

    const overdue = describeRow(proved, {
      ...context,
      claims: claims({ overdue: true }),
    });

    expect(overdue.note).toContain(day);
    expect(overdue.withdrawal).toMatchObject({ claim: { overdue: true } });
    expect(
      describeRow(proved, { ...context, claims: claims({ ready: true }) }),
    ).toMatchObject({ withdrawal: { ready: true } });
    // Its proof's game blacklisted, or the challenger won: no date, but
    // that the proof must be made again.
    expect(
      describeRow(proved, {
        ...context,
        claims: claims({ at: null, reprove: true }),
      }),
    ).toMatchObject({ withdrawal: { claim: null, reprove: true } });

    // Claimed: by a row of this history, or as the Portal says.
    const both = rowsOf(
      [
        { ...DEFAULTS, ...prove },
        { ...DEFAULTS, ...finalize },
      ],
      { network: bridged },
    );
    const [provedThenClaimed, claim] = [proved.hash, finalize.hash].map(
      (one) => /** @type {ActivityRow} */ (both.find((r) => r.hash === one)),
    );

    for (const [known, claimsRead] of [
      [provedThenClaimed, undefined],
      [proved, claims({ at: null, claimed: true })],
    ]) {
      expect(
        describeRow(/** @type {ActivityRow} */ (known), {
          ...context,
          claims: /** @type {any} */ (claimsRead),
        }),
      ).toMatchObject({
        amount: { muted: false, text: "1,008" },
        note: null,
        withdrawal: { claimed: true },
      });
    }

    expect(describeRow(claim, context)).toMatchObject({
      amount: { text: "1,008" },
      withdrawal: null,
    });

    // A call to the bridge that didn't read as one of its calls reads as before.
    expect(describeRow(row({ ...prove, bridge: null }), context)).toMatchObject(
      { amount: { text: "0" }, withdrawal: null },
    );
  });

  it("names a stake with Sozu and an unstake from it as staking, and no other contract's calls of the same name", () => {
    const pool =
      "72883945ac1aa032a88543aacc9e358d1dfef07717094c05296ce675f23078f2";
    const call = { contractId: pool, kind: "contract_call", to: undefined };

    expect(
      describeRow(row({ ...call, fnName: "sozu_stake" }), context),
    ).toMatchObject({
      amount: { sign: "−", text: "25" },
      category: "staking",
      icon: "staking",
    });
    expect(
      describeRow(
        row({ ...call, direction: "in", fnName: "sozu_unstake" }),
        context,
      ),
    ).toMatchObject({
      amount: { sign: "+" },
      category: "staking",
    });
    expect(
      describeRow(
        row({ ...call, contractId: "cd".repeat(32), fnName: "sozu_stake" }),
        context,
      ),
    ).toMatchObject({
      category: "sent",
      icon: "call",
      title: expect.stringContaining("sozu_stake"),
    });
  });

  it("says a shielded row is shielded", () => {
    expect(describeRow(row({ source: "shielded" }), context).privacy).toBe(
      "Shielded",
    );
  });
});

describe("transfers on the routes to and from other chains", () => {
  const [BSC_BRIDGE, ETHEREUM_PAYOUTS] = routes(networks.mainnet).flatMap(
    (route) =>
      route.kind === "migration" && route.payoutAccount
        ? [route.payoutAccount]
        : [],
  );
  const onMainnet = { network: networks.mainnet };
  const withRoutes = { ...context, net: networks.mainnet };

  it("are known by the routes' accounts, as the network's file calls them", () => {
    expect(
      [BSC_BRIDGE, ETHEREUM_PAYOUTS, ACCOUNT].map((account) =>
        routeLabel(networks.mainnet, account),
      ),
    ).toStrictEqual(["BSC bridge", "Ethereum migration payouts", null]);
    expect(routeLabel(null, BSC_BRIDGE)).toBeNull();

    // One the file doesn't name goes by its chain.
    const unnamed = {
      ...networks.mainnet,
      display: { ...networks.mainnet.display, labels: {} },
    };

    expect(
      [BSC_BRIDGE, ETHEREUM_PAYOUTS].map((account) =>
        routeLabel(unnamed, account),
      ),
    ).toStrictEqual([
      expect.stringContaining("BNB Smart Chain"),
      expect.stringContaining("Ethereum"),
    ]);
  });

  it("are the bridge's: a migration's payout in, and a transfer out to the route's account, named by their chain as the extension names them", () => {
    const payout = {
      direction: "in",
      from: ETHEREUM_PAYOUTS,
      memo: `0x${"c3".repeat(32)}`,
      to: undefined,
    };
    const out = row(
      { memo: `0x${"11".repeat(20)}`, to: BSC_BRIDGE },
      onMainnet,
    );

    expect(describeRow(row(payout, onMainnet), withRoutes)).toMatchObject({
      amount: { sign: "+" },
      category: "bridge",
      counterparty: ETHEREUM_PAYOUTS,
      icon: "bridge",
      title: expect.stringContaining("Ethereum"),
      titleIsAddress: false,
    });
    expect(describeRow(out, withRoutes)).toMatchObject({
      amount: { sign: "−" },
      category: "bridge",
      counterparty: BSC_BRIDGE,
      icon: "bridge",
      title: expect.stringContaining("BNB Smart Chain"),
    });
    expect(
      describeRow(row({ ...payout, from: BSC_BRIDGE }, onMainnet), withRoutes)
        .title,
    ).toContain("BNB Smart Chain");
    expect(
      matchesFilters(describeRow(out, withRoutes), out, { kind: "bridge" }),
    ).toBe(true);
    // What's bridged out was sent too, so Sent never looks as if it's gone.
    expect(
      matchesFilters(describeRow(out, withRoutes), out, { kind: "sent" }),
    ).toBe(true);
    expect(
      matchesFilters(describeRow(out, withRoutes), out, { kind: "received" }),
    ).toBe(false);

    // A send to an account that only pays migrations out isn't a transfer
    // out, though it goes by the account's name.
    expect(
      describeRow(row({ to: ETHEREUM_PAYOUTS }, onMainnet), withRoutes),
    ).toMatchObject({
      category: "sent",
      title: "Ethereum migration payouts",
    });
  });
});

describe("matchesFilters", () => {
  const sent = row({});
  const staked = row({ kind: "stake" });

  it("filters by what a row did, its privacy and its date", () => {
    const p = describeRow(sent, context);

    expect(matchesFilters(p, sent, { kind: "sent" })).toBe(true);
    expect(matchesFilters(p, sent, { kind: "received" })).toBe(false);
    expect(
      matchesFilters(describeRow(staked, context), staked, { kind: "staking" }),
    ).toBe(true);
    expect(matchesFilters(p, sent, { privacy: "shielded" })).toBe(false);
    expect(matchesFilters(p, sent, { since: Date.UTC(2026, 9, 27) })).toBe(
      false,
    );
    expect(matchesFilters(p, sent, { since: Date.UTC(2026, 9, 1) })).toBe(true);
  });
});
