import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/svelte";

import { renderWithSimpleContent } from "$lib/dusk/test-helpers";
import { networkStore } from "$lib/stores";

import { load } from "../+layout";
import WelcomeLayout from "../+layout.svelte";

const wallet = vi.hoisted(() => ({ isOpen: false }));

const SLOW_WORDS = "The network is taking longer than usual to answer.";

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {typeof import("$lib/stores")} */
  const original = await importOriginal();
  const { readable } = await import("svelte/store");
  const { vi } = await import("vitest");

  return {
    ...original,
    networkStore: {
      ...original.networkStore,
      ...readable({ connected: false, networkName: "testnet" }),
      // Still connecting.
      connect: vi.fn(() => new Promise(() => {})),
      init: vi.fn(() => new Promise(() => {})),
      reconnect: vi.fn(() => new Promise(() => {})),
    },
    walletStore: {
      ...original.walletStore,
      subscribe: (/** @type {(value: any) => void} */ run) =>
        original.walletStore.subscribe((store) =>
          run({ ...store, initialized: wallet.isOpen })
        ),
    },
  };
});

const { connect, init, reconnect } = vi.mocked(networkStore);

describe("The welcome screens' layout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connect.mockClear();
    init.mockClear();
    reconnect.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.doUnmock("$lib/stores");
  });

  it("takes Back from an open wallet to the wallet, not to what came before it", async () => {
    wallet.isOpen = true;

    await expect(
      load(/** @type {any} */ ({ url: new URL("http://localhost/setup") }))
    ).rejects.toMatchObject({
      location: "/some-base-path/dashboard",
      status: 307,
    });

    wallet.isOpen = false;

    await expect(
      load(/** @type {any} */ ({ url: new URL("http://localhost/setup") }))
    ).resolves.toBeUndefined();
  });

  it("is the wallet's frame: its top bar and the test network's strip over a column, not a card with a logo", () => {
    const { container, getByRole, getByText } = render(WelcomeLayout);

    expect(container.querySelector(".welcome-shell .top-bar")).toBeTruthy();
    expect(getByRole("img", { name: "Dusk Wallet" })).toBeInTheDocument();
    expect(getByRole("note")).toHaveTextContent("Testnet");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".welcome-shell__content")).toContainElement(
      getByText("Connecting to the network…")
    );
  });

  it("asks the node what it is while the socket connects, as neither needs the other", () => {
    render(WelcomeLayout);

    expect(connect).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledOnce();
  });

  it("says after some seconds what's going on, and offers to try again", async () => {
    const { getByRole, getByText, queryByText } = render(WelcomeLayout);

    await act(() => vi.advanceTimersByTime(4999));

    expect(queryByText(SLOW_WORDS)).toBeNull();

    await act(() => vi.advanceTimersByTime(1));

    expect(getByText(SLOW_WORDS)).toBeInTheDocument();
    expect(getByText("Connecting to the network…")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(reconnect).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledTimes(2);

    // A new try: quiet again for as long as the first.
    expect(queryByText(SLOW_WORDS)).toBeNull();
    expect(getByText("Connecting to the network…")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTime(5000));

    expect(getByText(SLOW_WORDS)).toBeInTheDocument();
  });

  it("says a new try is slow when the one before ends after it starts, as Try again stops it", async () => {
    const before = Promise.withResolvers();

    connect.mockReturnValueOnce(/** @type {any} */ (before.promise));

    const { getByRole, getByText, queryByText } = render(WelcomeLayout);

    await act(() => vi.advanceTimersByTime(5000));
    await fireEvent.click(getByRole("button", { name: "Try again" }));

    before.reject(new Error("Stopped to try again"));
    await act(() => vi.advanceTimersByTime(4999));

    expect(queryByText(SLOW_WORDS)).toBeNull();

    await act(() => vi.advanceTimersByTime(1));

    expect(getByText(SLOW_WORDS)).toBeInTheDocument();
    expect(getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("goes on as soon as a new try gets through, whatever came of the one before", async () => {
    renderWithSimpleContent(WelcomeLayout, {});

    await act(() => vi.advanceTimersByTime(5000));

    reconnect.mockResolvedValueOnce(/** @type {any} */ ({}));
    init.mockResolvedValueOnce();
    await fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(() => vi.advanceTimersByTime(0));

    expect(screen.queryByText("Connecting to the network…")).toBeNull();
    expect(screen.queryByText(SLOW_WORDS)).toBeNull();
    expect(screen.getByText("some text")).toBeInTheDocument();
  });

  it("says no more than Connecting when the node answers in time", async () => {
    connect.mockResolvedValueOnce(/** @type {any} */ ({}));
    init.mockResolvedValueOnce();

    renderWithSimpleContent(WelcomeLayout, {});

    await act(() => vi.advanceTimersByTime(60_000));

    expect(screen.getByText("some text")).toBeInTheDocument();
    expect(screen.queryByText(SLOW_WORDS)).toBeNull();
  });

  it("tries again by itself now and then once connecting failed, saying so until a try gets through, and at once as the browser is online again", async () => {
    connect.mockRejectedValueOnce(new Error("Failed to fetch"));
    reconnect.mockRejectedValueOnce(new Error("Failed to fetch"));

    renderWithSimpleContent(WelcomeLayout, {});

    await act(() => vi.advanceTimersByTime(0));

    expect(screen.getByText("Network connection issue")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTime(9999));

    expect(reconnect).not.toHaveBeenCalled();

    // A try that fails changes nothing on the screen.
    await act(() => vi.advanceTimersByTime(1));

    expect(reconnect).toHaveBeenCalledOnce();
    expect(screen.getByText("Network connection issue")).toBeInTheDocument();

    reconnect.mockResolvedValueOnce(/** @type {any} */ ({}));
    init.mockResolvedValueOnce();
    await act(() => vi.advanceTimersByTime(10_000));

    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Network connection issue")).toBeNull();
    expect(screen.getByText("some text")).toBeInTheDocument();

    cleanup();
    connect.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(WelcomeLayout);
    await act(() => vi.advanceTimersByTime(0));
    reconnect.mockClear();

    await act(() => window.dispatchEvent(new Event("online")));

    expect(reconnect).toHaveBeenCalledOnce();
    expect(screen.getByText("Connecting to the network…")).toBeInTheDocument();
  });

  it("stops trying by itself once the page has gone, though a try was under way", async () => {
    connect.mockRejectedValueOnce(new Error("Failed to fetch"));

    /** @type {(error: Error) => void} */
    let fail = () => {};

    reconnect.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      })
    );
    renderWithSimpleContent(WelcomeLayout, {});
    await act(() => vi.advanceTimersByTime(0));
    await act(() => vi.advanceTimersByTime(10_000));

    expect(reconnect).toHaveBeenCalledOnce();

    cleanup();
    await act(() => fail(new Error("Failed to fetch")));
    await act(() => vi.advanceTimersByTime(60_000));

    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("says when connecting failed, and tries again from there", async () => {
    connect.mockRejectedValueOnce(new Error("Failed to fetch"));

    const { getByRole, getByText, queryByText } = render(WelcomeLayout);

    await act(() => vi.advanceTimersByTime(0));

    expect(getByText("Network connection issue")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Try again" }));

    expect(reconnect).toHaveBeenCalledOnce();
    expect(queryByText("Network connection issue")).toBeNull();
    expect(getByText("Connecting to the network…")).toBeInTheDocument();
  });
});
