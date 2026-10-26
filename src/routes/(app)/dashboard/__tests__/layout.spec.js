import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { apiMarketData } from "$lib/mock-data";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import Layout from "../+layout.svelte";
import { load } from "../+layout.js";

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

const network = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  store: null,
}));

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { writable } = await import("svelte/store");

  network.store = writable({ connected: true, networkName: "mainnet" });

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      subscribe: network.store.subscribe,
    },
    walletStore: { ...original.walletStore, ...mockedWalletStore },
  };
});

describe("Dashboard Layout", () => {
  const initialState = mockedWalletStore.getMockedStoreValue();

  beforeEach(() => {
    mockedWalletStore.setMockedStoreValue(initialState);
  });

  afterEach(cleanup);

  afterAll(() => {
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
  });

  describe("Layout load", () => {
    const responseOK = new Response(JSON.stringify(apiMarketData), {
      status: 200,
    });
    const fetchMock = vi.fn().mockResolvedValue(responseOK);

    // @ts-ignore
    const loadData = () => load({ fetch: fetchMock });

    afterEach(() => {
      fetchMock.mockClear();
    });

    it('should return a promise that resolves with the data returned by the "quote" API', async () => {
      const result = /** @type {Record<string, any>} */ (await loadData());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.coingecko.com/api/v3/coins/dusk-network?community_data=false&developer_data=false&localization=false&market_data=true&sparkline=false&tickers=false"
      );

      await expect(result.currentPrice).resolves.toStrictEqual(
        apiMarketData.market_data.current_price
      );
    });

    it("should return a promise that resolves with an empty object if the expected properties in the returned data are missing", async () => {
      /* eslint-disable camelcase */
      const wrongResponse1 = new Response(JSON.stringify({ market_data: {} }), {
        status: 200,
      });
      /* eslint-enable camelcase */
      const wrongResponse2 = new Response(JSON.stringify({}), { status: 200 });

      fetchMock
        .mockResolvedValueOnce(wrongResponse1)
        .mockResolvedValueOnce(wrongResponse2);

      const result1 = /** @type {Record<string, any>} */ (await loadData());
      const result2 = /** @type {Record<string, any>} */ (await loadData());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://api.coingecko.com/api/v3/coins/dusk-network?community_data=false&developer_data=false&localization=false&market_data=true&sparkline=false&tickers=false"
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://api.coingecko.com/api/v3/coins/dusk-network?community_data=false&developer_data=false&localization=false&market_data=true&sparkline=false&tickers=false"
      );
      await expect(result1.currentPrice).resolves.toStrictEqual({});
      await expect(result2.currentPrice).resolves.toStrictEqual({});
    });

    it('should return a promise that resolves with an empty object if the fetch Response status is not "ok"', async () => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));

      const result = /** @type {Record<string, any>} */ (await loadData());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.coingecko.com/api/v3/coins/dusk-network?community_data=false&developer_data=false&localization=false&market_data=true&sparkline=false&tickers=false"
      );

      await expect(result.currentPrice).resolves.toStrictEqual({});
    });

    it("should ask for no market data off mainnet, as test DUSK has no value", async () => {
      network.store?.set({ connected: true, networkName: "testnet" });

      const result = /** @type {Record<string, any>} */ (await loadData());

      expect(fetchMock).not.toHaveBeenCalled();
      await expect(result.currentPrice).resolves.toStrictEqual({});

      network.store?.set({ connected: true, networkName: "mainnet" });
    });

    it("should return a promise that resolves with an empty object if the fetch fails or the Response contains invalid JSON", async () => {
      fetchMock
        .mockRejectedValueOnce(new Error("some error"))
        .mockResolvedValueOnce(new Response("}", { status: 200 }));

      const result1 = /** @type {Record<string, any>} */ (await loadData());
      const result2 = /** @type {Record<string, any>} */ (await loadData());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://api.coingecko.com/api/v3/coins/dusk-network?community_data=false&developer_data=false&localization=false&market_data=true&sparkline=false&tickers=false"
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://api.coingecko.com/api/v3/coins/dusk-network?community_data=false&developer_data=false&localization=false&market_data=true&sparkline=false&tickers=false"
      );
      await expect(result1.currentPrice).resolves.toStrictEqual({});
      await expect(result2.currentPrice).resolves.toStrictEqual({});
    });
  });

  it("should hold the dashboard's pages, and leave the balance and the network to them and the top bar", () => {
    const { container } = render(Layout);

    expect(container.querySelector("section.dashboard")).toBeTruthy();
    expect(container.querySelector(".dusk-balance")).toBeNull();
    expect(container.querySelector(".footer")).toBeNull();
    expect(container.querySelector(".address-picker")).toBeNull();
  });
});
