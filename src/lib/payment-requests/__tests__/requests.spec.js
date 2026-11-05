import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

import {
  forgetRequest,
  forgetWalletRequests,
  hydrateRequests,
  keepRequestMatches,
  matchRequests,
  rememberRequest,
  requestsStore,
} from "..";

const TO =
  "25z9o6qCaVk1ReyHjmB4pyXcE3D1vRu4FVV1rR8ChYcosdTSktkANLDHq9GD6B4985Q1S2KrDZYBRrohWAjrNmACFUb3UMSRyYctJRzh3d28R1ZNC1ZyKm1HwXL4FF5Etftt";
const SHIELDED =
  "47jNTgAhzn9KCKF3msCfvKg3k1P1QpPCLZ3HG3AoNp87sQ5WNS3QyjckYHWeuXqW7uvLmbKgejpP8Xkcip89vnMM";
const LUX = 150_000_000n;
const NOW = Date.now();
const HOUR = 3_600_000;

/** @param {Record<string, unknown>} [fields] */
const asked = (fields) => ({
  at: NOW,
  id: "a",
  lux: String(LUX),
  memo: "Factura 33",
  network: "testnet",
  to: TO,
  ...fields,
});

/** @param {Record<string, unknown>} [fields] */
const payment = (fields) =>
  /** @type {ActivityRow} */ ({
    category: "received",
    hash: "h1",
    memo: "Factura 33",
    privacy: "public",
    status: "executed",
    time: NOW + HOUR,
    value: LUX,
    ...fields,
  });

describe("The requests a wallet made", () => {
  describe("What came in for each", () => {
    it("should call a request paid only by a payment with its amount and its memo, both", () => {
      const list = [asked()];

      expect(matchRequests(list, [payment()]).get("a")).toStrictEqual({
        at: NOW + HOUR,
        hash: "h1",
        lux: LUX,
        matched: "amount-memo",
        memo: "Factura 33",
        state: "paid",
      });
    });

    it("should never call a guess paid: it says what matched, for checking", () => {
      const list = [asked()];

      expect(
        matchRequests(list, [payment({ memo: "Other" })]).get("a")
      ).toMatchObject({ matched: "amount", memo: "Other", state: "check" });
      expect(
        matchRequests(list, [payment({ value: 1n })]).get("a")
      ).toMatchObject({ lux: 1n, matched: "memo", state: "check" });
      // A request of an amount alone can't tell one payer from another.
      expect(
        matchRequests([asked({ memo: "" })], [payment({ memo: "" })]).get("a")
      ).toMatchObject({ matched: "amount", state: "check" });
      // Nor can one of a memo alone say what was due.
      expect(
        matchRequests([asked({ lux: null })], [payment()]).get("a")
      ).toMatchObject({ matched: "memo", state: "check" });
    });

    it("should say waiting with nothing that matches: another amount and memo, what failed or waits, what went out, and what came before", () => {
      for (const row of [
        payment({ memo: "Other", value: 1n }),
        payment({ status: "failed" }),
        payment({ status: "pending" }),
        payment({ category: "sent" }),
        payment({ time: NOW - HOUR }),
        payment({ time: null }),
      ]) {
        expect(matchRequests([asked()], [row]).get("a")).toStrictEqual({
          state: "waiting",
        });
      }
    });

    it("should let a payment answer one request: the one it matches best, then the oldest", () => {
      const list = [
        asked({ id: "older", memo: "" }),
        asked({ at: NOW + 1, id: "memo" }),
      ];
      const matches = matchRequests(list, [payment()]);

      expect(matches.get("memo")?.state).toBe("paid");
      expect(matches.get("older")?.state).toBe("waiting");

      const same = [
        asked({ id: "first", memo: "" }),
        asked({ at: NOW + 1, id: "second", memo: "" }),
      ];
      const one = matchRequests(same, [payment({ memo: "" })]);

      expect(one.get("first")?.state).toBe("check");
      expect(one.get("second")?.state).toBe("waiting");
    });

    it("should answer a request only with a payment to the address it asked on: public to the account, shielded to the shielded address", () => {
      const list = [
        asked({ id: "shielded", to: SHIELDED }),
        asked({ at: NOW + 1, id: "public" }),
      ];
      const fromPublic = matchRequests(list, [payment()]);

      expect(fromPublic.get("public")?.state).toBe("paid");
      expect(fromPublic.get("shielded")).toStrictEqual({ state: "waiting" });

      // A shielded payment has no memo to read: the amount alone, to check.
      const fromShielded = matchRequests(list, [
        payment({ hash: "h2", memo: null, privacy: "shielded" }),
      ]);

      expect(fromShielded.get("shielded")).toMatchObject({
        hash: "h2",
        matched: "amount",
        state: "check",
      });
      expect(fromShielded.get("public")).toStrictEqual({ state: "waiting" });
    });

    it("should say what else came in for a request answered: the same payment again, or one to check, but not one another request took", () => {
      const matches = matchRequests(
        [asked(), asked({ at: NOW + 1, id: "b", lux: "1", memo: "" })],
        [
          payment(),
          payment({ hash: "h2", time: NOW + 2 * HOUR }),
          payment({ hash: "h3", memo: "Fra 33", time: NOW + 3 * HOUR }),
          payment({ hash: "h4", memo: "", time: NOW + 4 * HOUR, value: 1n }),
        ]
      );

      expect(matches.get("a")).toStrictEqual({
        at: NOW + HOUR,
        hash: "h1",
        lux: LUX,
        matched: "amount-memo",
        memo: "Factura 33",
        more: [
          {
            at: NOW + 2 * HOUR,
            hash: "h2",
            lux: LUX,
            matched: "amount-memo",
            memo: "Factura 33",
          },
          {
            at: NOW + 3 * HOUR,
            hash: "h3",
            lux: LUX,
            matched: "amount",
            memo: "Fra 33",
          },
        ],
        state: "paid",
      });
      expect(matches.get("b")).toMatchObject({ hash: "h4", state: "check" });
      expect(matches.get("b")?.more).toBeUndefined();
    });

    it("should give a payment again to the request it matches in full, not to an older one it matches by amount", () => {
      const matches = matchRequests(
        [asked(), asked({ at: NOW + 1, id: "b", memo: "Factura 34" })],
        [
          payment(),
          payment({ hash: "h2", memo: "Factura 34", time: NOW + 2 * HOUR }),
          payment({ hash: "h3", memo: "Factura 34", time: NOW + 3 * HOUR }),
        ]
      );

      expect(matches.get("a")).toMatchObject({ hash: "h1", state: "paid" });
      expect(matches.get("a")?.more).toBeUndefined();
      expect(matches.get("b")).toMatchObject({
        hash: "h2",
        more: [{ hash: "h3", matched: "amount-memo" }],
        state: "paid",
      });
    });

    it("should prefer a payment with all of it to an earlier one with part of it", () => {
      const matches = matchRequests(
        [asked()],
        [
          payment({ hash: "h2", memo: "Other", time: NOW + 1 }),
          payment({ hash: "h3", time: NOW + 2 }),
        ]
      );

      expect(matches.get("a")).toMatchObject({ hash: "h3", state: "paid" });
    });
  });

  describe("What's kept", () => {
    beforeEach(() => {
      localStorage.clear();
      hydrateRequests();
    });

    afterEach(() => localStorage.clear());

    const ASKED = { lux: LUX, memo: "Factura 33", network: "testnet", to: TO };

    it("should keep one request for the same thing asked again while it's open, and read it back after a reload", () => {
      rememberRequest(ASKED);
      rememberRequest(ASKED);
      rememberRequest({ ...ASKED, memo: "Factura 34" });

      expect(get(requestsStore).map(({ memo }) => memo)).toStrictEqual([
        "Factura 34",
        "Factura 33",
      ]);
      expect(hydrateRequests()).toHaveLength(2);
    });

    it("should keep a payment that matched all of it, for the request to stay paid once it's too far back to read, and ask again as a new request", () => {
      rememberRequest(ASKED);

      const [{ at, id }] = get(requestsStore);
      const row = payment({ time: at + HOUR });

      keepRequestMatches(matchRequests(get(requestsStore), [row]));

      expect(matchRequests(get(requestsStore), []).get(id)).toMatchObject({
        hash: "h1",
        state: "paid",
      });

      rememberRequest(ASKED);

      expect(get(requestsStore)).toHaveLength(2);
    });

    it("should write nothing for what it has kept already, or has nothing to keep", () => {
      rememberRequest(ASKED);

      const [{ at }] = get(requestsStore);
      const row = payment({ time: at + HOUR });

      keepRequestMatches(matchRequests(get(requestsStore), [row]));

      const shown = get(requestsStore);
      const told = vi.fn();
      const stop = requestsStore.subscribe(told);

      told.mockClear();
      keepRequestMatches(matchRequests(shown, [row]));
      keepRequestMatches(matchRequests(shown, []));
      stop();

      expect(told).not.toHaveBeenCalled();
    });

    it("should keep what only needs checking from being kept as paid", () => {
      rememberRequest(ASKED);

      const [{ at, id }] = get(requestsStore);
      const row = payment({ memo: "Other", time: at + HOUR });

      keepRequestMatches(matchRequests(get(requestsStore), [row]));

      expect(matchRequests(get(requestsStore), []).get(id)).toStrictEqual({
        state: "waiting",
      });
    });

    it("should take one off the list, and forget a wallet's with it", () => {
      rememberRequest(ASKED);
      rememberRequest({ ...ASKED, memo: "Factura 34" });

      forgetRequest(get(requestsStore)[0].id);

      expect(get(requestsStore).map(({ memo }) => memo)).toStrictEqual([
        "Factura 33",
      ]);

      forgetWalletRequests("");

      expect(hydrateRequests()).toStrictEqual([]);
    });

    it("should stay a small list, the oldest settled going first", () => {
      rememberRequest({ ...ASKED, memo: "paid" });

      const [paid] = get(requestsStore);

      keepRequestMatches(
        new Map([[paid.id, { at: 1, hash: "h", state: "paid" }]])
      );

      for (let i = 0; i < 50; i += 1) {
        rememberRequest({ ...ASKED, memo: `open ${i}` });
      }

      const list = get(requestsStore);

      expect(list).toHaveLength(50);
      expect(list.some(({ id }) => id === paid.id)).toBe(false);
      expect(list.at(-1)?.memo).toBe("open 0");
    });

    it("should read nothing of what isn't a list of requests", () => {
      const name = `${CONFIG.LOCAL_STORAGE_APP_KEY}-payment-requests`;

      localStorage.setItem(name, "not json");
      expect(hydrateRequests()).toStrictEqual([]);

      localStorage.setItem(name, JSON.stringify([{ id: "x" }, asked()]));
      expect(hydrateRequests()).toStrictEqual([asked()]);
    });
  });
});
