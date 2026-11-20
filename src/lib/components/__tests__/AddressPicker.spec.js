import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import { Profile } from "@dusk/w3sper";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { shortenAddress } from "$lib/dusk/string";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";

import { AddressPicker } from "..";

const pageStore = vi.hoisted(() => ({
  /** @type {import("svelte/store").Writable<any> | null} */
  page: null,
}));

vi.mock("$app/stores", async () => {
  const { writable } = await import("svelte/store");

  pageStore.page = writable({ url: new URL("http://localhost/") });

  return { page: pageStore.page };
});

// A step of the history, as SvelteKit's shallow routing makes one.
vi.mock("$app/navigation", () => ({
  pushState: vi.fn((/** @type {string} */ _url, /** @type {any} */ state) =>
    pageStore.page?.update((page) => ({ ...page, state })),
  ),
}));

describe("AddressPicker", () => {
  const { currentProfile, profiles } = get(mockedWalletStore);

  const props = { currentProfile, profiles };

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  describe("Copy Address Functionality", () => {
    it("should copy public address when first copy button is clicked", async () => {
      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Get the first profile's first copy button (public address)
      const firstCopyButton = container.querySelector(
        ".address-picker__copy-button",
      );
      expect(firstCopyButton).toBeTruthy();

      if (firstCopyButton) {
        await fireEvent.click(firstCopyButton);
      }

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        profiles[0].account.toString(),
      );
    });

    it("should copy shielded address when second copy button is clicked", async () => {
      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Get the first profile's second copy button (shielded address)
      const copyButtons = container.querySelectorAll(
        ".address-picker__copy-button",
      );
      expect(copyButtons.length).toBeGreaterThan(1);

      const secondCopyButton = copyButtons[1];
      if (secondCopyButton) {
        await fireEvent.click(secondCopyButton);
      }

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        profiles[0].address.toString(),
      );
    });
  });

  describe("Dusk Domains names", () => {
    // The mocked profiles share one account: these two don't.
    const namedProfiles = [1, 2].map(
      (byte) => new Profile(new Uint8Array(64 + 96).fill(byte)),
    );
    const firstAccount = namedProfiles[0].account.toString();
    const namedProps = {
      currentProfile: namedProfiles[0],
      profiles: namedProfiles,
    };

    /** @param {HTMLElement} container */
    const getTrigger = (container) =>
      getAsHTMLElement(container, ".address-picker__trigger");

    it("should keep both copy buttons of a profile with a name, copying its full public and shielded addresses", async () => {
      const { container, findAllByText, getAllByRole } = render(AddressPicker, {
        ...namedProps,
        getName: vi.fn().mockResolvedValue("alice.dusk"),
      });

      await fireEvent.click(getTrigger(container));
      await findAllByText("alice.dusk", {
        selector: ".address-picker__address-name",
      });

      const [copyPublic] = getAllByRole("button", {
        name: "Copy public address",
      });
      const [copyShielded] = getAllByRole("button", {
        name: "Copy shielded address",
      });

      await fireEvent.click(copyPublic);
      await fireEvent.click(copyShielded);

      expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
        1,
        firstAccount,
      );
      expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
        2,
        namedProfiles[0].address.toString(),
      );
    });
  });

  describe("Wallets", () => {
    const OTHER_ACCOUNTS = ["other-account-one", "other-account-two"];

    // The other wallet's second shielded address wasn't seen.
    const OTHER_ADDRESSES = ["other-address-one"];

    /** @param {number} count */
    const walletsOf = (count) =>
      [
        { accounts: [], key: "k1", label: "Wallet 1", open: true },
        {
          accounts: OTHER_ACCOUNTS,
          addresses: OTHER_ADDRESSES,
          key: "k2",
          label: "Savings",
          open: false,
        },
      ].slice(0, count);

    /** @param {HTMLElement} container */
    const open = (container) =>
      fireEvent.click(getAsHTMLElement(container, ".address-picker__trigger"));

    it("lists another wallet's profiles as it last showed them, copies what they showed, and opens that wallet at the one picked", async () => {
      const switchWallet = vi.fn();
      const setCurrentProfile = vi.fn();
      const { container, getByRole } = render(AddressPicker, {
        events: { setCurrentProfile, switchWallet },
        props: { ...props, wallets: walletsOf(2) },
      });

      await open(container);

      const other = getByRole("group", { name: "Savings" });
      const [first, second] = other.querySelectorAll(
        ".address-picker__profile",
      );
      const copyButtonsOf = (/** @type {Element} */ profile) =>
        profile.querySelectorAll(".address-picker__copy-button");

      expect(other).toHaveTextContent(shortenAddress(OTHER_ACCOUNTS[1]));

      // Copied as they last showed: none where nothing was seen.
      expect(copyButtonsOf(first)).toHaveLength(2);
      expect(copyButtonsOf(second)).toHaveLength(1);

      await fireEvent.click(
        getAsHTMLElement(
          /** @type {HTMLElement} */ (first),
          "[aria-label='Copy shielded address']",
        ),
      );

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        OTHER_ADDRESSES[0],
      );

      // The one left copies the public account it showed.
      await fireEvent.click(copyButtonsOf(second)[0]);

      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
        OTHER_ACCOUNTS[1],
      );

      await fireEvent.click(
        /** @type {HTMLElement} */ (
          other.querySelectorAll("[role=menuitem]")[1]
        ),
      );

      expect(switchWallet).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { index: 1, key: "k2" } }),
      );
      expect(setCurrentProfile).not.toHaveBeenCalled();
      expect(container.querySelector(".address-picker__drop-down")).toBeNull();
    });
  });
});
