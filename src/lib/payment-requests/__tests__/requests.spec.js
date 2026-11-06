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

// What came in for each is app-core's to say (`matchRequests`), and its own
// tests say it: these are of what's kept here.
describe("The requests a wallet made", () => {
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
