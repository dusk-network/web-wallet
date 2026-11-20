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

/**
 * The text an element shows, without what only screen readers get.
 *
 * @param {Element} element
 */
const getShownText = (element) => {
  const shown = /** @type {Element} */ (element.cloneNode(true));

  shown.querySelectorAll(".sr-only").forEach((node) => node.remove());

  return shown.textContent?.trim() ?? "";
};

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
    const [firstAccount, secondAccount] = namedProfiles.map((profile) =>
      profile.account.toString(),
    );
    const namedProps = {
      currentProfile: namedProfiles[0],
      profiles: namedProfiles,
    };

    /** @param {HTMLElement} container */
    const getTrigger = (container) =>
      getAsHTMLElement(container, ".address-picker__trigger");

    /**
     * What the trigger shows the current profile as, under its label: its
     * name, or its account shortened while it has none.
     *
     * @param {HTMLElement} container
     */
    const getTriggerIdentity = (container) =>
      getShownText(
        getAsHTMLElement(
          getTrigger(container),
          ".address-picker__name, .address-picker__account",
        ),
      );

    /** Lets pending lookups settle. */
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    it("should show what a lookup finds over the name last verified", async () => {
      const { container } = render(AddressPicker, {
        ...namedProps,
        getKnownName: () => "alice.dusk",
        getName: vi.fn().mockResolvedValue(""),
      });

      await settle();

      // None found: the account, and nothing of the name kept from before.
      expect(getTriggerIdentity(container)).toBe(shortenAddress(firstAccount));
      expect(getTrigger(container)).not.toHaveAccessibleName(/alice\.dusk/);
    });

    it("should look up the name of the profile switched to, and drop the previous one's", async () => {
      /** @type {(name: string) => void} */
      let finishLookup = () => {};

      const getName = vi.fn((account) =>
        account === firstAccount
          ? Promise.resolve("alice.dusk")
          : new Promise((resolve) => {
              finishLookup = resolve;
            }),
      );
      const { container, rerender } = render(AddressPicker, {
        ...namedProps,
        getName,
      });

      await vi.waitFor(() =>
        expect(getTriggerIdentity(container)).toBe("alice.dusk"),
      );

      await rerender({ currentProfile: namedProfiles[1] });

      // The second profile's account while its own name is looked up, never
      // the first one's name.
      expect(getName).toHaveBeenLastCalledWith(secondAccount);
      expect(getTriggerIdentity(container)).toBe(shortenAddress(secondAccount));
      expect(getTrigger(container)).not.toHaveAccessibleName(/alice\.dusk/);

      finishLookup("bob.dusk");

      await vi.waitFor(() => {
        expect(getTriggerIdentity(container)).toBe("bob.dusk");
        expect(getTrigger(container)).toHaveAccessibleName(/(^|\s)bob\.dusk\b/);
      });
    });

    it("should look the name up again with a new lookup, as on another network", async () => {
      const { container, rerender } = render(AddressPicker, {
        ...namedProps,
        getName: vi.fn().mockResolvedValue("alice.dusk"),
      });

      await vi.waitFor(() =>
        expect(getTriggerIdentity(container)).toBe("alice.dusk"),
      );

      const getName = vi.fn().mockResolvedValue("");

      await rerender({ getName });
      await settle();

      // None on the other network: the account, never the name from before.
      expect(getName).toHaveBeenCalledExactlyOnceWith(firstAccount);
      expect(getTriggerIdentity(container)).toBe(shortenAddress(firstAccount));
      expect(getTrigger(container)).not.toHaveAccessibleName(/alice\.dusk/);
    });

    // The pill is the picker the top bar shows: its name follows the
    // profile's lookup alone.
    it("should never show in the top bar's pill what the previous profile's lookup finds after the switch", async () => {
      /** @type {Record<string, (name: string) => void>} */
      const finish = {};

      const getName = vi.fn(
        (account) =>
          new Promise((resolve) => {
            finish[account] = resolve;
          }),
      );
      const { container, rerender } = render(AddressPicker, {
        ...namedProps,
        compact: true,
        getName,
      });

      await vi.waitFor(() =>
        expect(getName).toHaveBeenCalledWith(firstAccount),
      );
      await rerender({ currentProfile: namedProfiles[1] });

      // The first profile's answer comes once the second one shows.
      finish[firstAccount]("alice.dusk");
      await settle();

      expect(getTrigger(container)).not.toHaveTextContent("alice");
      expect(getTrigger(container)).not.toHaveAccessibleName(/alice/);

      finish[secondAccount]("bob.dusk");

      await vi.waitFor(() => {
        expect(
          getShownText(
            getAsHTMLElement(container, ".address-picker__compact-name"),
          ),
        ).toBe("bob.dusk");
        expect(getTrigger(container)).toHaveAccessibleName(/(^|\s)bob\.dusk\b/);
      });
    });

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

      // The row picked below shows the account it opens at.
      expect(
        getShownText(
          getAsHTMLElement(
            /** @type {HTMLElement} */ (second),
            ".address-picker__address-value",
          ),
        ),
      ).toBe(shortenAddress(OTHER_ACCOUNTS[1]));

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
