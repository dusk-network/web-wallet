import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import ScanQR from "../Contract/Operations/ScanQR/ScanQR.svelte";
import "jsdom-worker";

describe("ScanQR", () => {
	afterEach(cleanup);

	it("renders the ScanQR component", () => {
		const { container } = render(ScanQR);

		expect(container.firstChild).toMatchSnapshot();
	});
});
