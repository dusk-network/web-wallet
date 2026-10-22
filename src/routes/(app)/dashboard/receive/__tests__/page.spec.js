import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";

import { walletStore } from "$lib/stores";

import Receive from "../+page.svelte";

vi.useFakeTimers();

const { getPrimaryName } = vi.hoisted(() => ({ getPrimaryName: vi.fn() }));

vi.mock("$lib/dusk-domains", () => ({ getPrimaryName }));

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

  beforeEach(() => {
    getPrimaryName.mockResolvedValue("");
  });

  afterEach(() => {
    cleanup();
    getPrimaryName.mockReset();
  });

  afterAll(() => {
    vi.doUnmock("$lib/dusk-domains");
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

  describe("Dusk Domains names", () => {
    /** @param {Element} container */
    const getShownName = (container) =>
      container.querySelector(".receive__name")?.textContent ?? "";

    it("should show the public account's name, looked up once the page has rendered", async () => {
      /** @type {Element | null} */
      let renderedAddress = null;

      getPrimaryName.mockImplementation(() => {
        renderedAddress = document.querySelector(".receive__address");

        return Promise.resolve("alice.dusk");
      });

      const { container, getByText } = render(Receive);

      await vi.runAllTimersAsync();

      expect(renderedAddress).toBeInstanceOf(HTMLElement);
      expect(getShownName(container)).toBe("alice.dusk");
      expect(getByText(expectedAccount)).toBeInTheDocument();
      expect(getPrimaryName).toHaveBeenCalledExactlyOnceWith(
        expectedAccount,
        "unknown",
        expect.any(String),
        undefined
      );
    });

    it.each([
      ["pays to it", "alice.dusk"],
      ["doesn't pay to it", ""],
    ])(
      "should show the name with the shielded address only if the name %s",
      async (_, shieldedName) => {
        getPrimaryName.mockImplementation(
          (account, network, nodeUrl, shieldedAddress) =>
            Promise.resolve(shieldedAddress ? shieldedName : "alice.dusk")
        );

        const { container, getByRole, getByText } = render(Receive);

        await vi.runAllTimersAsync();

        expect(getShownName(container)).toBe("alice.dusk");

        await fireEvent.click(getByRole("radio", { checked: false }));
        await vi.runAllTimersAsync();

        expect(getByText(expectedAddress)).toBeInTheDocument();
        expect(getShownName(container)).toBe(shieldedName);
        expect(getPrimaryName).toHaveBeenLastCalledWith(
          expectedAccount,
          "unknown",
          expect.any(String),
          expectedAddress
        );
      }
    );

    it("should show no name when the lookup fails", async () => {
      getPrimaryName.mockRejectedValue(new Error("Lookup failed"));

      const { container, getByText } = render(Receive);

      await vi.runAllTimersAsync();

      expect(container.querySelector(".receive__name")).toBeNull();
      expect(getByText(expectedAccount)).toBeInTheDocument();
    });
  });
});
