import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedShieldedStatusStore from "$lib/mocks/mockedShieldedStatusStore";
import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import { walletStore } from "$lib/stores";

import Receive from "../+page.svelte";

vi.useFakeTimers();

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

vi.mock("$lib/stores", async (importOriginal) => {
  /** @type {WalletStore} */
  const original = await importOriginal();

  return {
    ...original,
    shieldedStatusStore: mockedShieldedStatusStore,
    walletStore: {
      ...mockedWalletStore,
    },
  };
});

describe("Receive", () => {
  const currentProfile = /** @type {Profile} */ (
    get(walletStore).currentProfile
  );
  const expectedAddress = currentProfile.address.toString();
  const expectedAccount = currentProfile.account.toString();

  afterEach(() => {
    cleanup();
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: true,
      isPaused: false,
    });
  });

  afterAll(() => {
    vi.doUnmock("$lib/dusk/string");
    vi.doUnmock("$lib/stores");
    vi.useRealTimers();
  });

  it("should render the receive page with a choice to switch from public to shielded address", async () => {
    const { container, getByRole, getByText } = render(Receive);

    await vi.runAllTimersAsync();

    expect(getByRole("radiogroup")).toBeInTheDocument();
    expect(getByText(expectedAccount)).toBeInTheDocument();
    expect(() => getByText(expectedAddress)).toThrow();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should show the shielded address when the user makes such choice", async () => {
    const { container, getByRole, getByText } = render(Receive);

    await vi.runAllTimersAsync();

    expect(getByText(expectedAccount)).toBeInTheDocument();
    expect(() => getByText(expectedAddress)).toThrow();

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();

    expect(() => getByText(expectedAccount)).toThrow();
    expect(getByText(expectedAddress)).toBeInTheDocument();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should show a notice instead of the shielded address while shielded transactions are paused", async () => {
    mockedShieldedStatusStore.setMockedStoreValue({
      isKnown: true,
      isPaused: true,
    });

    const { container, getByRole, getByText, queryByRole, queryByText } =
      render(Receive);

    await vi.runAllTimersAsync();

    expect(getByText(expectedAccount)).toBeInTheDocument();
    expect(getByRole("button", { name: "Copy" })).toBeInTheDocument();

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();

    expect(
      getByText("Shielded transactions are paused on this network.")
    ).toBeInTheDocument();
    expect(queryByText(expectedAddress)).not.toBeInTheDocument();
    expect(container.querySelector(".receive")).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/some-base-path/dashboard"
    );
  });
});
