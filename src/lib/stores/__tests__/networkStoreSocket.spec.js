import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real network here, on a socket the test controls.
vi.unmock("@dusk/w3sper");

const SESSION = "a".repeat(32);

/** A browser's WebSocket, for as much of it as the network uses. */
class TestSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  /** @type {TestSocket[]} */
  static made = [];

  /** @type {((event: Event) => void) | null} */
  onerror = null;

  readyState = TestSocket.CONNECTING;

  /** @param {string | URL} url */
  constructor(url) {
    super();
    this.url = url;
    TestSocket.made.push(this);
  }

  /** The node answers the handshake. */
  open() {
    this.readyState = TestSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  /** The node says the session. */
  async sayHello() {
    // The network listens for it only once it knows it's open.
    await Promise.resolve();
    this.dispatchEvent(new MessageEvent("message", { data: SESSION }));
  }

  close() {
    const failed = this.readyState === TestSocket.CONNECTING;

    this.readyState = TestSocket.CLOSING;

    // As a browser does: never within the call.
    setTimeout(() => {
      this.readyState = TestSocket.CLOSED;

      if (failed) {
        this.onerror?.(new Event("error"));
      }

      this.dispatchEvent(new Event("close"));
    });
  }

  send() {}
}

describe("Connecting to the network", () => {
  /** @type {NetworkStore} */
  let store;

  beforeEach(async () => {
    TestSocket.made = [];
    vi.stubGlobal("WebSocket", TestSocket);
    vi.useFakeTimers();
    vi.resetModules();
    store = (await import("..")).networkStore;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.mocked(fetch).mockClear();
  });

  /** The attempt under way got as far as its socket. */
  const toTheSocket = async (/** @type {number} */ count = 1) => {
    await vi.waitFor(() => expect(TestSocket.made).toHaveLength(count));

    return TestSocket.made[count - 1];
  };

  it("gets there as soon as the node opens the socket and says the session", async () => {
    const connecting = store.connect();
    const socket = await toTheSocket();

    socket.open();
    await socket.sayHello();

    expect(await connecting).toHaveProperty("connected", true);
    expect(TestSocket.made).toHaveLength(1);
  });

  it("makes one attempt, whoever asks meanwhile, and asks for the wallet core once", async () => {
    const first = store.connect();
    const second = store.connect();
    const socket = await toTheSocket();
    const third = store.connect();

    socket.open();

    // Open, but it hasn't said its session: not there yet.
    const fourth = store.connect();

    await socket.sayHello();
    await Promise.all([first, second, third, fourth]);

    expect(TestSocket.made).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
  });

  it("gives up after ten seconds, and the next attempt doesn't wait for the socket that never answered", async () => {
    const connecting = store.connect();
    const failed = expect(connecting).rejects.toThrow(
      "Timed out while connecting to the network"
    );
    const stuck = await toTheSocket();

    await vi.advanceTimersByTimeAsync(10_000);
    await failed;

    expect(stuck.readyState).toBe(TestSocket.CLOSED);

    const again = store.connect();
    const socket = await toTheSocket(2);

    socket.open();
    await socket.sayHello();

    expect(await again).toHaveProperty("connected", true);
  });

  it("starts over when asked to, without waiting out the attempt under way", async () => {
    const first = store.connect();
    const failed = expect(first).rejects.toThrow("Stopped to try again");
    const stuck = await toTheSocket();
    const again = store.reconnect();

    await vi.advanceTimersByTimeAsync(0);
    await failed;

    expect(stuck.readyState).toBe(TestSocket.CLOSED);

    const socket = await toTheSocket(2);

    socket.open();
    await socket.sayHello();

    expect(await again).toHaveProperty("connected", true);
    expect(TestSocket.made).toHaveLength(2);
  });

  it("closes a socket that opened but never said its session, as nothing could subscribe on it", async () => {
    const connecting = store.connect();
    const failed = expect(connecting).rejects.toThrow("Timed out");
    const silent = await toTheSocket();

    silent.open();

    await vi.advanceTimersByTimeAsync(10_000);
    await failed;

    expect(silent.readyState).toBe(TestSocket.CLOSED);

    const again = store.connect();
    const socket = await toTheSocket(2);

    socket.open();
    await socket.sayHello();

    await expect(again).resolves.toHaveProperty("connected", true);
  });

  it("keeps the socket it has when asked to start over with nothing wrong with it", async () => {
    const connecting = store.connect();
    const socket = await toTheSocket();

    socket.open();
    await socket.sayHello();
    await connecting;

    await expect(store.reconnect()).resolves.toHaveProperty("connected", true);

    expect(TestSocket.made).toHaveLength(1);
    expect(socket.readyState).toBe(TestSocket.OPEN);
  });

  it("loads no wallet core from an error page, and the next attempt gets the real one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Bad gateway", { status: 502 })
    );

    await expect(store.connect()).rejects.toThrow(
      "The wallet core couldn't be loaded"
    );

    expect(TestSocket.made).toHaveLength(0);

    const again = store.connect();
    const socket = await toTheSocket();

    socket.open();
    await socket.sayHello();

    await expect(again).resolves.toHaveProperty("connected", true);
  });
});
