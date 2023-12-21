import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import * as appNavigation from "$app/navigation";

import Settings from "../+page.svelte";
import { walletStore } from "$lib/stores";

vi.useFakeTimers();

describe("Settings", () => {
	afterEach(cleanup);

	const gotoSpy = vi.spyOn(appNavigation, "goto");

	it("should render the settings page", () => {
		const { container } = render(Settings, {});

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should clear local data, reset wallet store, and navigate on clicking the Log Out button", async () => {
		const { getByRole } = render(Settings);

		const clearLocalDataMock = vi.fn(() => Promise.resolve());

		walletStore.clearLocalData = clearLocalDataMock;

		const resetMock = vi.fn();

		walletStore.reset = resetMock;

		const button = getByRole("button", { name: "Log out" });

		await fireEvent.click(button);

		await vi.waitUntil(() => gotoSpy.mock.calls.length > 0);

		expect(clearLocalDataMock).toHaveBeenCalled();

		await vi.advanceTimersToNextTimerAsync();

		expect(resetMock).toHaveBeenCalled();

		expect(gotoSpy).toHaveBeenCalledTimes(1);

		expect(gotoSpy).toHaveBeenCalledWith("/");

		gotoSpy.mockRestore();
	});
});
