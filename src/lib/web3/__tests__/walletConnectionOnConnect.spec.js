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
});
