import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
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

  // The QR code shows once its PNG is made, which Node deflates on its
  // threadpool: running the fake timers doesn't wait for that.
  const qrCodeDrawn = () =>
    vi.waitFor(() => screen.getByRole("img", { name: "Key QR code" }));

  beforeEach(() => {
    getPrimaryName.mockResolvedValue("");
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
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
    await qrCodeDrawn();

    expect(getByRole("radiogroup")).toBeInTheDocument();
    expect(getByText(expectedAccount)).toBeInTheDocument();
    expect(() => getByText(expectedAddress)).toThrow();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should copy the full address shown from its field, with no other copy button", async () => {
    const { getAllByRole, getByRole } = render(Receive);

    await vi.runAllTimersAsync();

    expect(
      getAllByRole("button").map((button) => button.getAttribute("aria-label"))
    ).toStrictEqual(["Copy address"]);
    expect(getByRole("link", { name: "Back" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expectedAccount
    );

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();
    await fireEvent.click(getByRole("button", { name: "Copy address" }));

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      expectedAddress
    );
  });

  it("should show the shielded address when the user makes such choice", async () => {
    const { container, getByRole, getByText } = render(Receive);

    await vi.runAllTimersAsync();

    expect(getByText(expectedAccount)).toBeInTheDocument();
    expect(() => getByText(expectedAddress)).toThrow();

    await fireEvent.click(getByRole("radio", { checked: false }));
    await vi.runAllTimersAsync();
    await qrCodeDrawn();

    expect(() => getByText(expectedAccount)).toThrow();
    expect(getByText(expectedAddress)).toBeInTheDocument();
    expect(container.firstElementChild).toMatchSnapshot();
  });

  describe("Dusk Domains names", () => {
    /** @param {Element} container */
    const getShownName = (container) =>
      container.querySelector(".receive__name")?.textContent ?? "";

    /** @param {Element} container */
    const getNote = (container) => container.querySelector(".receive__note");

    it("should show the public account's name, looked up once the page has rendered, with what it reaches behind its info button", async () => {
      /** @type {Element | null} */
      let renderedAddress = null;

      getPrimaryName.mockImplementation(() => {
        renderedAddress = document.querySelector(".receive__address");

        return Promise.resolve("alice.dusk");
      });

      const { container, getByRole, getByText } = render(Receive);

      await vi.runAllTimersAsync();

      expect(renderedAddress).toBeInstanceOf(HTMLElement);
      expect(getShownName(container)).toBe("alice.dusk");
      expect(getByText(expectedAccount)).toBeInTheDocument();
      expect(getNote(container)).not.toBeVisible();
      expect(getPrimaryName).toHaveBeenCalledExactlyOnceWith(
        expectedAccount,
        "unknown",
        expect.any(String),
        undefined
      );

      await fireEvent.click(getByRole("button", { name: "About this name" }));

      expect(getNote(container)).toBeVisible();
      expect(getNote(container)).toHaveTextContent(
        "People who send to alice.dusk reach this public account."
      );
    });

    it.each([
      [
        "pays to it",
        "alice.dusk",
        "People who pay alice.dusk choose public or shielded. Anyone can see this address belongs to alice.dusk.",
      ],
      ["doesn't pay to it", "", ""],
    ])(
      "should show the name with the shielded address only if the name %s",
      async (_, shieldedName, shieldedNote) => {
        getPrimaryName.mockImplementation(
          (account, network, nodeUrl, shieldedAddress) =>
            Promise.resolve(shieldedAddress ? shieldedName : "alice.dusk")
        );

        const { container, getByRole, getByText, queryByRole } =
          render(Receive);

        await vi.runAllTimersAsync();

        expect(getShownName(container)).toBe("alice.dusk");

        await fireEvent.click(getByRole("radio", { checked: false }));
        await vi.runAllTimersAsync();

        expect(getByText(expectedAddress)).toBeInTheDocument();
        expect(getShownName(container)).toBe(shieldedName);
        expect(getNote(container)?.textContent?.trim() ?? "").toBe(
          shieldedNote
        );
        expect(queryByRole("button", { name: "Copy name" }) !== null).toBe(
          Boolean(shieldedName)
        );
        expect(
          queryByRole("button", { name: "About this name" }) !== null
        ).toBe(Boolean(shieldedName));
        expect(getByRole("button", { name: "Copy address" })).toBeVisible();
        expect(getPrimaryName).toHaveBeenLastCalledWith(
          expectedAccount,
          "unknown",
          expect.any(String),
          expectedAddress
        );
      }
    );

    it("should show no name, and only the address to copy, when the lookup fails", async () => {
      getPrimaryName.mockRejectedValue(new Error("Lookup failed"));

      const { container, getAllByRole, getByText } = render(Receive);

      await vi.runAllTimersAsync();

      expect(container.querySelector(".receive__name")).toBeNull();
      expect(getNote(container)).toBeNull();
      expect(getByText(expectedAccount)).toBeInTheDocument();
      expect(
        getAllByRole("button").map((button) =>
          button.getAttribute("aria-label")
        )
      ).toStrictEqual(["Copy address"]);
    });

    it("should copy the name from its field, and the full address from its own", async () => {
      getPrimaryName.mockResolvedValue("alice.dusk");

      const { getByRole } = render(Receive);

      await vi.runAllTimersAsync();
      await fireEvent.click(getByRole("button", { name: "Copy name" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        "alice.dusk"
      );

      await fireEvent.click(getByRole("button", { name: "Copy address" }));

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        expectedAccount
      );
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    });
  });
});
