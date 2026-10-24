import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { Profile } from "@dusk/w3sper";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { shortenAddress } from "$lib/dusk/string";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";

import { AddressPicker } from "..";

// Mock the toast module
vi.mock("$lib/dusk/components/Toast/store", () => ({
  toast: vi.fn(),
}));

vi.mock("$lib/dusk/string", async (importOriginal) => {
  /** @type {typeof import("$lib/dusk/string")} */
  const original = await importOriginal();

  return {
    ...original,
    randomUUID: () => "some-generated-id",
  };
});

import { toast } from "$lib/dusk/components/Toast/store";

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

  it("renders the AddressPicker component", () => {
    const { container } = render(AddressPicker, props);

    expect(container.firstElementChild).toMatchSnapshot();
  });

  it("should be able to render the component if the current profile is `null`", () => {
    const { container } = render(AddressPicker, {
      ...props,
      currentProfile: null,
    });

    expect(container.firstElementChild).toMatchSnapshot();
  });

  describe("Multiple Profiles Functionality", () => {
    it("should show dropdown when enableMultipleProfiles is true and trigger is clicked", async () => {
      const { container } = render(AddressPicker, props);

      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      expect(trigger).toHaveAttribute("role", "button");
      expect(trigger).toHaveAttribute("tabindex", "0");

      // Should have chevron icon
      expect(container.querySelector(".address-picker__chevron")).toBeTruthy();

      // Initially dropdown should be closed
      expect(container.querySelector(".address-picker__drop-down")).toBeNull();

      // Click to open dropdown
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Dropdown should now be visible
      expect(
        container.querySelector(".address-picker__drop-down")
      ).toBeTruthy();
    });

    it("should dispatch setCurrentProfile event when a profile is selected", async () => {
      const mockHandler = vi.fn();
      const { container } = render(AddressPicker, {
        events: { setCurrentProfile: mockHandler },
        props,
      });

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Click on a profile option
      const profileOptions = container.querySelectorAll(
        ".address-picker__profile-button"
      );
      expect(profileOptions.length).toBeGreaterThan(0);

      if (profileOptions.length > 0) {
        await fireEvent.click(profileOptions[0]);
      }

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            profile: expect.any(Object),
          }),
        })
      );
    });

    it("should close dropdown after profile selection", async () => {
      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Verify dropdown is open
      expect(
        container.querySelector(".address-picker__drop-down")
      ).toBeTruthy();

      // Click on a profile option
      const profileOptions = container.querySelectorAll(
        ".address-picker__profile-button"
      );
      if (profileOptions.length > 0) {
        await fireEvent.click(profileOptions[0]);
      }

      // Dropdown should be closed
      expect(container.querySelector(".address-picker__drop-down")).toBeNull();
    });

    it("should handle keyboard navigation", async () => {
      const { container } = render(AddressPicker, props);

      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();

      // Test Enter key to open dropdown
      if (trigger) {
        await fireEvent.keyDown(trigger, { key: "Enter" });
      }
      expect(
        container.querySelector(".address-picker__drop-down")
      ).toBeTruthy();

      // Test Escape key to close dropdown
      if (trigger) {
        await fireEvent.keyDown(trigger, { key: "Escape" });
      }
      expect(container.querySelector(".address-picker__drop-down")).toBeNull();

      // Test Space key to open dropdown
      if (trigger) {
        await fireEvent.keyDown(trigger, { key: " " });
      }
      expect(
        container.querySelector(".address-picker__drop-down")
      ).toBeTruthy();

      // Test ArrowDown key when closed
      if (trigger) {
        await fireEvent.keyDown(trigger, { key: "Escape" }); // Close first
        await fireEvent.keyDown(trigger, { key: "ArrowDown" });
      }
      expect(
        container.querySelector(".address-picker__drop-down")
      ).toBeTruthy();
    });

    it("should show all profiles in the dropdown list", async () => {
      // Use the first two profiles from the existing profiles array
      const testProfiles = profiles.slice(0, 2);

      const { container } = render(AddressPicker, {
        ...props,
        currentProfile: testProfiles[0],
        profiles: testProfiles,
      });

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Check that all profiles are listed
      const profileOptions = container.querySelectorAll(
        ".address-picker__profile-button"
      );
      expect(profileOptions).toHaveLength(testProfiles.length);

      // Check that current profile is marked as selected
      const selectedProfile = container.querySelector(
        ".address-picker__profile--selected"
      );
      expect(selectedProfile).toBeTruthy();
    });

    it("should handle edge case with single profile", async () => {
      const singleProfile = [profiles[0]];

      const { container } = render(AddressPicker, {
        ...props,
        currentProfile: singleProfile[0],
        profiles: singleProfile,
      });

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Should show one profile option
      const profileOptions = container.querySelectorAll(
        ".address-picker__profile-button"
      );
      expect(profileOptions).toHaveLength(1);
    });
  });

  describe("Copy Address Functionality", () => {
    beforeEach(() => {
      // Reset clipboard mock for each test
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });
    });

    it("should show copy buttons for each profile's public and shielded addresses", async () => {
      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Should have copy button containers for each profile
      const copyButtonContainers = container.querySelectorAll(
        ".address-picker__copy-buttons"
      );
      expect(copyButtonContainers).toHaveLength(profiles.length);

      // Each container should have 2 copy buttons (public and shielded)
      copyButtonContainers.forEach((buttonContainer) => {
        const copyButtons = buttonContainer.querySelectorAll(
          ".address-picker__copy-button"
        );
        expect(copyButtons).toHaveLength(2);
        expect(copyButtons[0]).toHaveAccessibleName("Copy public address");
        expect(copyButtons[0]).toHaveTextContent("Public");
        expect(copyButtons[1]).toHaveAccessibleName("Copy shielded address");
        expect(copyButtons[1]).toHaveTextContent("Shielded");
      });
    });

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
        ".address-picker__copy-button"
      );
      expect(firstCopyButton).toBeTruthy();

      if (firstCopyButton) {
        await fireEvent.click(firstCopyButton);
      }

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        profiles[0].account.toString()
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
        ".address-picker__copy-button"
      );
      expect(copyButtons.length).toBeGreaterThan(1);

      const secondCopyButton = copyButtons[1];
      if (secondCopyButton) {
        await fireEvent.click(secondCopyButton);
      }

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        profiles[0].address.toString()
      );
    });

    it("should handle clipboard errors gracefully", async () => {
      const mockToast = vi.mocked(toast);
      const clipboardError = new Error("Clipboard access denied");
      clipboardError.name = "NotAllowedError";

      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockRejectedValue(clipboardError),
        },
      });

      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Click first copy button
      const firstCopyButton = container.querySelector(
        ".address-picker__copy-button"
      );
      expect(firstCopyButton).toBeTruthy();

      if (firstCopyButton) {
        await fireEvent.click(firstCopyButton);
      }

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        "error",
        "Clipboard access denied",
        expect.any(String)
      );
    });

    it("should show success toast when copy is successful", async () => {
      const mockToast = vi.mocked(toast);

      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Click first copy button
      const firstCopyButton = container.querySelector(
        ".address-picker__copy-button"
      );
      expect(firstCopyButton).toBeTruthy();

      if (firstCopyButton) {
        await fireEvent.click(firstCopyButton);
      }

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        "success",
        "Address copied",
        expect.any(String)
      );
    });
  });

  describe("Profile Display", () => {
    it("should display profile header with correct format", async () => {
      const { container } = render(AddressPicker, props);
      const trigger = getAsHTMLElement(container, ".address-picker__trigger");

      expect(trigger).toBeInTheDocument();

      await fireEvent.click(trigger);

      // Check profile headers
      const profileHeaders = container.querySelectorAll(
        ".address-picker__profile-header"
      );

      expect(currentProfile).toBe(profiles[0]);
      expect(profileHeaders).toHaveLength(profiles.length);
      expect(profileHeaders[0]).toHaveTextContent("Profile 1");
      expect(profileHeaders[0]).toHaveTextContent("(Current)");
    });

    it("should list each profile on two lines, its label and its account shortened, with the account in full on hover and for screen readers", async () => {
      const { container, getAllByRole, queryByText } = render(
        AddressPicker,
        props
      );

      await fireEvent.click(
        getAsHTMLElement(container, ".address-picker__trigger")
      );

      const items = getAllByRole("menuitem");

      expect(items).toHaveLength(profiles.length);

      items.forEach((item, index) => {
        const account = profiles[index].account.toString();
        const label = `Profile ${index + 1}${index === 0 ? " (Current)" : ""}`;
        const accountLine = getAsHTMLElement(
          item,
          ".address-picker__address-value"
        );

        expect(Array.from(item.children, getShownText)).toStrictEqual([
          label,
          shortenAddress(account),
        ]);
        expect(accountLine).toHaveAttribute("title", account);
        expect(item).toHaveAccessibleName(`${label} ${account}`);
      });

      // The profiles' shielded addresses are left to their copy buttons.
      expect(queryByText("Public Account")).not.toBeInTheDocument();
      expect(queryByText("Shielded Account")).not.toBeInTheDocument();
      expect(
        queryByText(profiles[0].address.toString(), { exact: false })
      ).not.toBeInTheDocument();
    });

    it("should show current profile with proper display format", () => {
      const { container } = render(AddressPicker, props);

      const currentProfileDisplay = container.querySelector(
        ".address-picker__current-profile"
      );
      expect(currentProfileDisplay).toBeTruthy();
      expect(
        getAsHTMLElement(container, ".address-picker__account")
      ).toHaveAttribute("title", currentProfile.account.toString());

      // "Profile X" for every profile, as the list names them.
      const profileIndex = profiles.indexOf(currentProfile) + 1;

      expect(
        getAsHTMLElement(container, ".address-picker__title")
      ).toHaveTextContent(new RegExp(`^Profile ${profileIndex}$`));
      expect(currentProfileDisplay).not.toHaveTextContent("(Default)");
    });

    it("should handle null currentProfile gracefully", () => {
      const { container } = render(AddressPicker, {
        ...props,
        currentProfile: null,
      });

      const currentProfileDisplay = container.querySelector(
        ".address-picker__current-profile"
      );
      expect(currentProfileDisplay).toBeTruthy();
      expect(currentProfileDisplay).toHaveTextContent("No profile selected");
      expect(container.querySelector(".address-picker__account")).toBeNull();
      expect(container.querySelector(".address-picker__name")).toBeNull();
    });
  });

  describe("Dusk Domains names", () => {
    // The mocked profiles share one account: these two don't.
    const namedProfiles = [1, 2].map(
      (byte) => new Profile(new Uint8Array(64 + 96).fill(byte))
    );
    const [firstAccount, secondAccount] = namedProfiles.map((profile) =>
      profile.account.toString()
    );
    const namedProps = {
      currentProfile: namedProfiles[0],
      profiles: namedProfiles,
    };

    /** @param {HTMLElement} container */
    const getTrigger = (container) =>
      getAsHTMLElement(container, ".address-picker__trigger");

    /** @param {Element} container */
    const getTriggerName = (container) =>
      container.querySelector(".address-picker__name");

    /**
     * The trigger's two lines, as shown: the profile's label, and its
     * name or account.
     *
     * @param {Element} container
     */
    const getTriggerLines = (container) =>
      Array.from(
        container.querySelectorAll(".address-picker__current-profile > span"),
        getShownText
      );

    /** Lets pending lookups settle. */
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    it("should show the current profile's label with its name under it, looked up once the picker has rendered", async () => {
      /** @type {Element | null} */
      let renderedPicker = null;

      const getName = vi.fn(() => {
        renderedPicker = document.querySelector(".address-picker__trigger");

        return Promise.resolve("alice.dusk");
      });
      const { container, findByText, queryByText } = render(AddressPicker, {
        ...namedProps,
        getName,
      });

      expect(await findByText("alice.dusk")).toBeInTheDocument();
      expect(renderedPicker).toBeInstanceOf(HTMLElement);
      expect(getName).toHaveBeenCalledExactlyOnceWith(firstAccount);
      expect(getTriggerLines(container)).toStrictEqual([
        "Profile 1",
        "alice.dusk",
      ]);
      expect(getTriggerName(container)).toHaveAttribute("title", "alice.dusk");
      expect(getTrigger(container)).toHaveAccessibleName(
        "Select address profile"
      );
      expect(getTrigger(container)).toHaveAccessibleDescription(
        "Profile 1 alice.dusk"
      );
      expect(queryByText(firstAccount, { exact: false })).toBeNull();
      expect(container.querySelector(".address-picker__account")).toBeNull();
    });

    it.each([
      ["has none", () => Promise.resolve("")],
      ["can't be looked up", () => Promise.reject(new Error("Lookup failed"))],
      ["is being looked up", () => new Promise(() => {})],
    ])(
      "should show the current profile's label with its account shortened under it, and no name, when the profile's name %s",
      async (_, lookUp) => {
        const getName = vi.fn(lookUp);
        const { container } = render(AddressPicker, {
          ...namedProps,
          getName,
        });

        await waitFor(() => expect(getName).toHaveBeenCalledOnce());
        await settle();

        expect(getTriggerName(container)).toBeNull();
        expect(getTriggerLines(container)).toStrictEqual([
          "Profile 1",
          shortenAddress(firstAccount),
        ]);
        expect(
          getAsHTMLElement(container, ".address-picker__account")
        ).toHaveAttribute("title", firstAccount);
        expect(getTrigger(container)).toHaveAccessibleDescription(
          `Profile 1 ${firstAccount}`
        );
      }
    );

    it("should look up the name of the profile switched to, and drop the previous one's", async () => {
      /** @type {(name: string) => void} */
      let finishLookup = () => {};

      const getName = vi.fn((account) =>
        account === firstAccount
          ? Promise.resolve("alice.dusk")
          : new Promise((resolve) => {
              finishLookup = resolve;
            })
      );
      const { container, findByText, rerender } = render(AddressPicker, {
        ...namedProps,
        getName,
      });

      expect(await findByText("alice.dusk")).toBeInTheDocument();

      await rerender({ currentProfile: namedProfiles[1] });

      expect(getTriggerName(container)).toBeNull();
      expect(getTriggerLines(container)).toStrictEqual([
        "Profile 2",
        shortenAddress(secondAccount),
      ]);
      expect(getName).toHaveBeenLastCalledWith(secondAccount);

      finishLookup("bob.dusk");

      expect(await findByText("bob.dusk")).toBeInTheDocument();
      expect(getTriggerLines(container)).toStrictEqual([
        "Profile 2",
        "bob.dusk",
      ]);
    });

    it("should look the name up again with a new lookup, as on another network", async () => {
      const { container, findByText, queryByText, rerender } = render(
        AddressPicker,
        {
          ...namedProps,
          getName: vi.fn().mockResolvedValue("alice.dusk"),
        }
      );

      expect(await findByText("alice.dusk")).toBeInTheDocument();

      const getName = vi.fn().mockResolvedValue("");

      await rerender({ getName });
      await settle();

      expect(queryByText("alice.dusk")).not.toBeInTheDocument();
      expect(getName).toHaveBeenCalledExactlyOnceWith(firstAccount);
      expect(getTriggerLines(container)).toStrictEqual([
        "Profile 1",
        shortenAddress(firstAccount),
      ]);
    });

    it("should list each profile with its name under its label, or its account shortened while it has none, looked up when the list opens", async () => {
      const getName = vi.fn((account) =>
        Promise.resolve(account === secondAccount ? "bob.dusk" : "")
      );
      const { container, findByText, getAllByRole } = render(AddressPicker, {
        ...namedProps,
        getName,
      });

      await waitFor(() => expect(getName).toHaveBeenCalledOnce());
      await fireEvent.click(getTrigger(container));

      const name = await findByText("bob.dusk");
      const [firstItem, secondItem] = getAllByRole("menuitem");

      expect(getName).toHaveBeenCalledTimes(3);
      expect(getName).toHaveBeenLastCalledWith(secondAccount);
      expect(secondItem).toContainElement(name);
      expect(name).toHaveClass("address-picker__address-name");
      expect(name).toHaveAttribute("title", "bob.dusk");
      expect(Array.from(secondItem.children, getShownText)).toStrictEqual([
        "Profile 2",
        "bob.dusk",
      ]);
      expect(secondItem).toHaveAccessibleName("Profile 2 bob.dusk");
      expect(secondItem).not.toHaveTextContent(secondAccount);
      expect(Array.from(firstItem.children, getShownText)).toStrictEqual([
        "Profile 1 (Current)",
        shortenAddress(firstAccount),
      ]);
      expect(firstItem).toHaveAccessibleName(
        `Profile 1 (Current) ${firstAccount}`
      );
      expect(
        container.querySelectorAll(".address-picker__address-name")
      ).toHaveLength(1);
      expect(getTriggerName(container)).toBeNull();
    });

    it.each([
      ["can't be looked up", () => Promise.reject(new Error("Lookup failed"))],
      ["is being looked up", () => new Promise(() => {})],
    ])(
      "should list a profile with its account shortened, and no name, while its name %s",
      async (_, lookUp) => {
        const getName = vi.fn(lookUp);
        const { container, getAllByRole } = render(AddressPicker, {
          ...namedProps,
          getName,
        });

        await fireEvent.click(getTrigger(container));
        await settle();

        const items = getAllByRole("menuitem");

        expect(getName).toHaveBeenCalledTimes(3);
        expect(
          container.querySelector(".address-picker__address-name")
        ).toBeNull();
        expect(items.map((item) => getShownText(item.children[1]))).toEqual([
          shortenAddress(firstAccount),
          shortenAddress(secondAccount),
        ]);
      }
    );

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
        firstAccount
      );
      expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
        2,
        namedProfiles[0].address.toString()
      );
    });
  });
});
