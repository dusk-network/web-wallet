import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { get } from "svelte/store";
import { Profile } from "@dusk/w3sper";

import mockedWalletStore from "$lib/mocks/mockedWalletStore";
import { calculateAdaptiveCharCount, middleEllipsis } from "$lib/dusk/string";
import { getAsHTMLElement } from "$lib/dusk/test-helpers";

import { AddressPicker } from "..";

// Mock the toast module
vi.mock("$lib/dusk/components/Toast/store", () => ({
  toast: vi.fn(),
}));

import { toast } from "$lib/dusk/components/Toast/store";

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

    it("should display both public and shielded addresses with proper labels", async () => {
      const { container } = render(AddressPicker, props);

      // Open dropdown
      const trigger = container.querySelector(".address-picker__trigger");
      expect(trigger).toBeTruthy();
      if (trigger) {
        await fireEvent.click(trigger);
      }

      // Check address labels
      const publicLabels = container.querySelectorAll(
        ".address-picker__address-label"
      );

      // Should have both Public and Shielded labels for each profile
      const publicLabelTexts = Array.from(publicLabels).map(
        (label) => label.textContent
      );
      expect(publicLabelTexts).toContain("Public Account");
      expect(publicLabelTexts).toContain("Shielded Account");
    });

    it("should show current profile with proper display format", () => {
      const { container } = render(AddressPicker, props);

      const currentProfileDisplay = container.querySelector(
        ".address-picker__current-profile"
      );
      expect(currentProfileDisplay).toBeTruthy();

      // Should show "Profile X (Default)" format for first profile or "Profile X" for others
      const profileIndex = profiles.indexOf(currentProfile) + 1;
      const expectedText =
        profileIndex === 1
          ? `Profile ${profileIndex} (Default)`
          : `Profile ${profileIndex}`;

      expect(currentProfileDisplay).toHaveTextContent(expectedText);
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
      expect(container.querySelector(".address-picker__subtitle")).toBeNull();
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

    /** @param {string} account */
    const shortened = (account) =>
      middleEllipsis(account, calculateAdaptiveCharCount(window.innerWidth));

    /** @param {Element} container */
    const getTriggerName = (container) =>
      container.querySelector(".address-picker__name");

    /**
     * The trigger's two lines: the title and the line under it.
     *
     * @param {Element} container
     */
    const getTriggerLines = (container) =>
      Array.from(
        container.querySelectorAll(".address-picker__current-profile > span"),
        (line) => line.textContent
      );

    /** Lets pending lookups settle. */
    const settle = () => new Promise((resolve) => setTimeout(resolve));

    it("should show the current profile's name, with the profile and its account under it, looked up once the picker has rendered", async () => {
      /** @type {Element | null} */
      let renderedPicker = null;

      const getName = vi.fn(() => {
        renderedPicker = document.querySelector(".address-picker__trigger");

        return Promise.resolve("alice.dusk");
      });
      const { container, findByText } = render(AddressPicker, {
        ...namedProps,
        getName,
      });

      expect(await findByText("alice.dusk")).toBeInTheDocument();
      expect(renderedPicker).toBeInstanceOf(HTMLElement);
      expect(getName).toHaveBeenCalledExactlyOnceWith(firstAccount);
      expect(getTriggerLines(container)).toStrictEqual([
        "alice.dusk",
        `Profile 1 · ${middleEllipsis(firstAccount, 6)}`,
      ]);
    });

    it.each([
      ["has none", () => Promise.resolve("")],
      ["can't be looked up", () => Promise.reject(new Error("Lookup failed"))],
      ["is being looked up", () => new Promise(() => {})],
    ])(
      "should show the profile and its account, and no name, when the profile's name %s",
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
          "Profile 1 (Default)",
          middleEllipsis(firstAccount, 10),
        ]);
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
        middleEllipsis(secondAccount, 10),
      ]);
      expect(getName).toHaveBeenLastCalledWith(secondAccount);

      finishLookup("bob.dusk");

      expect(await findByText("bob.dusk")).toBeInTheDocument();
      expect(getTriggerLines(container)).toStrictEqual([
        "bob.dusk",
        `Profile 2 · ${middleEllipsis(secondAccount, 6)}`,
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
        "Profile 1 (Default)",
        middleEllipsis(firstAccount, 10),
      ]);
    });

    it("should show the listed profiles' names, looked up when the list opens", async () => {
      const getName = vi.fn((account) =>
        Promise.resolve(account === secondAccount ? "bob.dusk" : "")
      );
      const { container, findByText } = render(AddressPicker, {
        ...namedProps,
        getName,
      });

      await waitFor(() => expect(getName).toHaveBeenCalledOnce());
      await fireEvent.click(
        getAsHTMLElement(container, ".address-picker__trigger")
      );

      const name = await findByText("bob.dusk");
      const [, secondProfile] = container.querySelectorAll(
        ".address-picker__profile"
      );

      expect(getName).toHaveBeenCalledTimes(3);
      expect(getName).toHaveBeenLastCalledWith(secondAccount);
      expect(secondProfile).toContainElement(name);
      expect(name.parentElement).toHaveTextContent(shortened(secondAccount));
      expect(
        container.querySelectorAll(".address-picker__address-name")
      ).toHaveLength(1);
      expect(getTriggerName(container)).toBeNull();
    });
  });
});
