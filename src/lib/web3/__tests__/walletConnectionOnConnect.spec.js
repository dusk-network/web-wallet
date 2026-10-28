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

/**
 * The connections the test loaded, one for each page it opened.
 *
 * @type {(typeof import("../walletConnection"))[]}
 */
const pages = [];

/**
 * The connection, as a page that opens loads it, on a testnet node:
 * started by nothing.
 */
const load = async () => {
  vi.resetModules();

  const connection = await import("../walletConnection");
  const { networks } = await import("@dusk-network/networks");

  (await import("$lib/stores/nodeNetwork")).setNodeNetwork(networks.testnet);
  pages.push(connection);

  return connection;
};

/**
 * A wallet as wagmi connects it, whose own disconnect does `disconnect`.
 *
 * @param {import("@wagmi/core").Config} config
 * @param {() => Promise<void>} [disconnect]
 */
function connectWallet(config, disconnect = async () => {}) {
  const connector = {
    disconnect: vi.fn(disconnect),
    emitter: { off: () => {}, on: () => {} },
    id: "injected",
    name: "A wallet",
    type: "injected",
    uid: "uid",
  };

  config.setState((state) => ({
    ...state,
    connections: new Map([
      [
        "uid",
        /** @type {any} */ ({
          accounts: [`0x${"1e".repeat(20)}`],
          chainId: 1,
          connector,
        }),
      ],
    ]),
    current: "uid",
    status: "connected",
  }));

  return connector;
}

describe("the EVM wallet connection, on Connect", () => {
  beforeEach(() => {
    vi.mocked(createAppKit).mockReset();
  });

  afterEach(async () => {
    // Reset deletes WalletConnect's database in the background, which no
    // page waits for: the test does, so that delete doesn't go on into the
    // next test, or past the end of the file.
    await Promise.all(
      pages.splice(0).map((connection) => connection.settledDeletes())
    );
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

  it("should forget the wallets connected here, as Reset does: none comes back, nor connects until the page reloads", async () => {
    const appKit = stubAppKit();
    const {
      connectionBlocked,
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

    // Nor does a wallet connect while the delete waits on this page's own
    // handle: a session written now would go with it. A reload it takes.
    expect(get(connectionBlocked)).toBe(false);

    await modal.open();

    expect(appKit.open).not.toHaveBeenCalled();
    expect(wasConnectedBefore()).toBe(false);
    expect(get(connectionBlocked)).toBe(true);

    // The next page, where nothing holds the database open: the delete is
    // done, and then Connect connects.
    held.close();

    const next = await load();

    await next.modal.open();

    expect(appKit.open).toHaveBeenCalledOnce();
    expect(get(next.connectionBlocked)).toBe(false);
    expect((await indexedDB.databases()).map(({ name }) => name)).not.toContain(
      "WALLET_CONNECT_V2_INDEXED_DB"
    );
    await vi.waitFor(() =>
      expect(
        localStorage.getItem("web-wallet-evm-wallets-forgotten")
      ).toBeNull()
    );
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

  it("should start nothing for a Connect that Reset came after, as AppKit loaded", async () => {
    const appKit = stubAppKit();
    /** @type {PromiseWithResolvers<void>} */
    const asked = Promise.withResolvers();
    /** @type {PromiseWithResolvers<void>} */
    const loaded = Promise.withResolvers();

    // AppKit takes a while to load.
    vi.doMock("@reown/appkit-adapter-wagmi", async (importOriginal) => {
      asked.resolve();
      await loaded.promise;

      return importOriginal();
    });

    try {
      const { connectionFailed, forgetEvmWallets, modal, wasConnectedBefore } =
        await load();
      const opening = modal.open();

      // Reset, while AppKit loads for Connect.
      await asked.promise;
      await forgetEvmWallets();
      loaded.resolve();
      await opening;

      expect(createAppKit).not.toHaveBeenCalled();
      expect(appKit.open).not.toHaveBeenCalled();
      expect(get(connectionFailed)).toBe(false);
      expect(wasConnectedBefore()).toBe(false);

      // Connect, pressed after Reset, connects.
      await modal.open();

      expect(createAppKit).toHaveBeenCalledOnce();
      expect(appKit.open).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock("@reown/appkit-adapter-wagmi");
    }
  });

  it("should open no dialog for a Connect that Reset came after, as it waited", async () => {
    const appKit = stubAppKit();
    /** @type {{ promise: Promise<[]> }} */
    const reconnected = { promise: Promise.resolve([]) };

    vi.doMock("@wagmi/core", async (importOriginal) => ({
      .../** @type {typeof import("@wagmi/core")} */ (await importOriginal()),
      reconnect: () => reconnected.promise,
    }));

    try {
      const { forgetEvmWallets, modal, wasConnectedBefore } = await load();

      // Reset, as Connect waits for the last Reset's delete…
      await forgetEvmWallets();

      const afterDelete = modal.open();

      await forgetEvmWallets();
      await afterDelete;

      expect(createAppKit).not.toHaveBeenCalled();
      expect(wasConnectedBefore()).toBe(false);

      // …or for a wallet connected before to reconnect.
      /** @type {PromiseWithResolvers<[]>} */
      const reconnecting = Promise.withResolvers();

      reconnected.promise = reconnecting.promise;

      const afterReconnect = modal.open();

      await vi.waitFor(() => expect(createAppKit).toHaveBeenCalledOnce());
      await forgetEvmWallets();
      reconnecting.resolve([]);
      await afterReconnect;

      expect(appKit.open).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@wagmi/core");
    }
  });

  it("should drop a wallet that comes back after Reset, until Connect is pressed again", async () => {
    const appKit = stubAppKit();
    const connection = await load();

    await connection.startWalletConnection();
    await connection.forgetEvmWallets();

    // A reconnect under way as Reset ran brings the wallet back.
    const back = connectWallet(connection.wagmiConfig);

    await vi.waitFor(() => expect(back.disconnect).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(localStorage.getItem("wagmi.store")).toBeNull()
    );
    expect(get(connection.account).isConnected).toBe(false);
    expect(appKit.disconnect).toHaveBeenCalledTimes(2);

    // Connect, pressed after Reset: the wallet it connects stays.
    await connection.modal.open();
    connectWallet(connection.wagmiConfig);

    expect(appKit.open).toHaveBeenCalledOnce();
    expect(get(connection.account).isConnected).toBe(true);
  });

  it("should end AppKit's session on Reset even when wagmi's disconnect fails", async () => {
    const appKit = stubAppKit();
    const connection = await load();

    await connection.startWalletConnection();

    const stuck = connectWallet(connection.wagmiConfig, () =>
      Promise.reject(new Error("The wallet didn't answer"))
    );

    await connection.forgetEvmWallets();

    expect(stuck.disconnect).toHaveBeenCalledOnce();
    expect(appKit.disconnect).toHaveBeenCalledOnce();

    // The failure is still said, once both were tried.
    await expect(connection.walletDisconnect()).rejects.toThrow(
      "The wallet didn't answer"
    );
    expect(appKit.disconnect).toHaveBeenCalledTimes(2);
  });
});
