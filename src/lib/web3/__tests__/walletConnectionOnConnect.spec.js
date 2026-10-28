import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { createAppKit } from "@reown/appkit";

/** A stand-in for AppKit's dialog, its events sent by `emit`. */
function stubAppKit() {
  /** @type {((event: any) => void)[]} */
  const listeners = [];
  const appKit = {
    disconnect: vi.fn(),
    emit: (/** @type {any} */ event) =>
      listeners.forEach((listener) => listener(event)),
    open: vi.fn(),
    subscribeEvents: vi.fn((/** @type {(event: any) => void} */ listener) => {
      listeners.push(listener);

      return () => {};
    }),
  };

  vi.mocked(createAppKit).mockReturnValue(/** @type {any} */ (appKit));

  return appKit;
}

/** The connection, as a page that opens loads it: started by nothing. */
const load = async () => {
  vi.resetModules();

  return import("../walletConnection");
};

describe("the EVM wallet connection, on Connect", () => {
  beforeEach(() => {
    vi.mocked(createAppKit).mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should load AppKit only as its dialog opens, once, and then open it", async () => {
    const appKit = stubAppKit();
    const { modal } = await load();

    expect(createAppKit).not.toHaveBeenCalled();

    await modal.open();
    await modal.open();

    expect(createAppKit).toHaveBeenCalledOnce();
    expect(appKit.open).toHaveBeenCalledTimes(2);
  });

  it("should pass the dialog's events on to what followed them before it loaded", async () => {
    const appKit = stubAppKit();
    const { modal } = await load();
    const handler = vi.fn();
    const stopped = vi.fn();
    const stop = modal.subscribeEvents(stopped);

    modal.subscribeEvents(handler);
    stop();
    await modal.open();
    appKit.emit({ data: { event: "CONNECT_SUCCESS" } });

    expect(handler).toHaveBeenCalledWith({
      data: { event: "CONNECT_SUCCESS" },
    });
    expect(stopped).not.toHaveBeenCalled();
  });

  it("should say when it couldn't load, and load on the next try", async () => {
    vi.mocked(createAppKit).mockImplementationOnce(() => {
      throw new Error("offline");
    });

    const { connectionFailed, modal } = await load();

    await modal.open();

    expect(get(connectionFailed)).toBe(true);

    const appKit = stubAppKit();

    await modal.open();

    expect(get(connectionFailed)).toBe(false);
    expect(appKit.open).toHaveBeenCalledOnce();
  });

  it("should know a wallet was connected before from wagmi's store, or the connection started already", async () => {
    stubAppKit();

    const { startWalletConnection, wasConnectedBefore } = await load();
    const keep = (/** @type {unknown} */ state) =>
      localStorage.setItem(
        "wagmi.store",
        JSON.stringify({ state, version: 3 })
      );

    expect(wasConnectedBefore()).toBe(false);

    keep({ connections: { __type: "Map", value: [] }, current: null });

    expect(wasConnectedBefore()).toBe(false);

    keep({
      connections: { __type: "Map", value: [["uid", {}]] },
      current: "uid",
    });

    expect(wasConnectedBefore()).toBe(true);

    localStorage.setItem("wagmi.store", "{not json");

    expect(wasConnectedBefore()).toBe(false);

    await startWalletConnection();

    expect(wasConnectedBefore()).toBe(true);
  });

  it("should forget the wallets connected here, as Reset does: none comes back until Connect is pressed", async () => {
    const appKit = stubAppKit();
    const {
      forgetEvmWallets,
      modal,
      startWalletConnection,
      wasConnectedBefore,
    } = await load();
    const connection = [
      "-walletlink:https://www.walletlink.org:session:id",
      "@appkit/connection_status",
      "@appkit/wallet_id",
      "@w3m/connected_wallet_image_url",
      "WALLETCONNECT_DEEPLINK_CHOICE",
      "wagmi.recentConnectorId",
      "wagmi.store",
      "wc@2:core:0.3//keychain",
    ];

    for (const key of connection) {
      localStorage.setItem(key, "kept by the connection");
    }

    // The wallet's own, and the bridge's.
    localStorage.setItem("web-wallet-preferences", "{}");
    localStorage.setItem("dusk-evm:withdrawal-activity:v1", "[]");

    // WalletConnect's database, which its client holds open while it runs.
    /** @type {IDBDatabase} */
    const held = await new Promise((resolve) => {
      const request = indexedDB.open("WALLET_CONNECT_V2_INDEXED_DB");

      request.onupgradeneeded = () =>
        request.result.createObjectStore("keyvaluestorage");
      request.onsuccess = () => {
        const transaction = request.result.transaction(
          "keyvaluestorage",
          "readwrite"
        );

        transaction
          .objectStore("keyvaluestorage")
          .put("a session", "wc@2:client:0.3//session");
        transaction.oncomplete = () => resolve(request.result);
      };
    });

    // A page brought the wallet back.
    await startWalletConnection();

    expect(wasConnectedBefore()).toBe(true);

    await forgetEvmWallets();

    // Held open, the database is emptied, and goes with the next page.
    const left = () =>
      new Promise((resolve) => {
        const request = held
          .transaction("keyvaluestorage")
          .objectStore("keyvaluestorage")
          .getAllKeys();

        request.onsuccess = () => resolve(request.result);
      });

    await vi.waitFor(async () => expect(await left()).toStrictEqual([]));
    expect(Object.keys(localStorage).sort()).toStrictEqual([
      "dusk-evm:withdrawal-activity:v1",
      "web-wallet-evm-wallets-forgotten",
      "web-wallet-preferences",
    ]);
    expect(appKit.disconnect).toHaveBeenCalledOnce();
    // No page starts the connection now, as the wallet would come back.
    expect(wasConnectedBefore()).toBe(false);

    // A second Reset in the page doesn't wait on the database it can't open.
    await forgetEvmWallets();

    // Pressing Connect does.
    await modal.open();

    expect(wasConnectedBefore()).toBe(true);
    expect(appKit.open).toHaveBeenCalledOnce();

    // The next page, where nothing holds the database open.
    held.close();
    await load();
    await vi.waitFor(async () => {
      expect(
        (await indexedDB.databases()).map(({ name }) => name)
      ).not.toContain("WALLET_CONNECT_V2_INDEXED_DB");
      expect(
        localStorage.getItem("web-wallet-evm-wallets-forgotten")
      ).toBeNull();
    });
  });

  it("should delete as a page opens the database Reset left to it, and only then", async () => {
    const databases = async () =>
      (await indexedDB.databases()).map(({ name }) => name);

    // WalletConnect's database, which nothing holds open now.
    await new Promise((resolve) => {
      const request = indexedDB.open("WALLET_CONNECT_V2_INDEXED_DB");

      request.onupgradeneeded = () =>
        request.result.createObjectStore("keyvaluestorage");
      request.onsuccess = () => {
        request.result.close();
        resolve(undefined);
      };
    });

    // A page opens with no Reset before it: the database stays.
    await load();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await databases()).toContain("WALLET_CONNECT_V2_INDEXED_DB");

    // A page opens after a Reset that couldn't delete it.
    localStorage.setItem("web-wallet-evm-wallets-forgotten", "1");
    await load();
    await vi.waitFor(async () => {
      expect(await databases()).not.toContain("WALLET_CONNECT_V2_INDEXED_DB");
      expect(
        localStorage.getItem("web-wallet-evm-wallets-forgotten")
      ).toBeNull();
    });
  });
});
