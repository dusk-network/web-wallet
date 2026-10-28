import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/svelte";

import { renderWithSlots } from "$lib/dusk/test-helpers";

import {
  connectionFailed,
  startWalletConnection,
  wasConnectedBefore,
} from "$lib/web3/walletConnection";

import { WalletConnectionGate } from "..";

vi.mock("$lib/web3/walletConnection", async () => {
  const { writable } = await import("svelte/store");

  return {
    connectionFailed: writable(false),
    startWalletConnection: vi.fn(),
    wasConnectedBefore: vi.fn(),
  };
});

/** The gate, around a page. */
const renderGate = () =>
  renderWithSlots({ default: "The Bridge page" })(WalletConnectionGate, {
    props: {},
  });

/** @param {boolean} failed */
const setFailed = (failed) =>
  /** @type {import("svelte/store").Writable<boolean>} */ (
    connectionFailed
  ).set(failed);

describe("WalletConnectionGate", () => {
  afterEach(() => {
    cleanup();
    setFailed(false);
    vi.clearAllMocks();
  });

  it("should show the page at once, and load nothing, when no wallet was connected before", () => {
    vi.mocked(wasConnectedBefore).mockReturnValue(false);

    const { getByText } = renderGate();

    expect(getByText("The Bridge page")).toBeInTheDocument();
    expect(startWalletConnection).not.toHaveBeenCalled();
  });

  it("should bring a wallet connected before back, and then show the page", async () => {
    const started = Promise.withResolvers();

    vi.mocked(wasConnectedBefore).mockReturnValue(true);
    vi.mocked(startWalletConnection).mockReturnValue(started.promise);

    const { getByText, queryByText } = renderGate();

    expect(getByText("Loading the EVM wallet connection…")).toBeInTheDocument();
    expect(queryByText("The Bridge page")).toBeNull();

    await act(() => started.resolve(undefined));

    expect(getByText("The Bridge page")).toBeInTheDocument();
  });

  it("should say when the connection couldn't load, and try again", async () => {
    vi.mocked(wasConnectedBefore).mockReturnValue(false);
    vi.mocked(startWalletConnection).mockResolvedValue(undefined);

    const { getByRole, getByText } = renderGate();

    await act(() => setFailed(true));

    expect(getByRole("alert")).toHaveTextContent(
      "Couldn't load the EVM wallet connection. Check your connection."
    );

    await fireEvent.click(
      /** @type {HTMLElement} */ (getByRole("button", { name: "Try again" }))
    );

    expect(startWalletConnection).toHaveBeenCalledOnce();

    await act(() => setFailed(false));

    expect(getByText("The Bridge page")).toBeInTheDocument();
  });
});
