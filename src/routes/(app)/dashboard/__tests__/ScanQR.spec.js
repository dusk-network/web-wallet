import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import ScanQR from "../Contract/Operations/ScanQR/ScanQR.svelte";
import "jsdom-worker";

describe("ScanQR", () => {
	afterEach(cleanup);

	it("renders the ScanQR component", () => {
		const { container } = render(ScanQR);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("check if scan button is disabled when no camera is detected", async () => {
		const { getByRole } = render(ScanQR);

		const scan = getByRole("button", { name: "SCAN QR" });

		expect(scan).toBeDisabled();
	});

	it("check if scan window openes on click", async () => {
		const { getByRole } = render(ScanQR);

		const scan = getByRole("button", { name: "SCAN QR" });

		scan.setAttribute("disabled", "false");
		await fireEvent.click(scan);

		const close = getByRole("button", { name: "CLOSE" });

		expect(close).toBeInTheDocument();
	});

	it("check if scan window closes on click", async () => {
		const { container, getByRole } = render(ScanQR);

		const scan = getByRole("button", { name: "SCAN QR" });

		scan.setAttribute("disabled", "false");
		await fireEvent.click(scan);

		const close = getByRole("button", { name: "CLOSE" });

		await fireEvent.click(close);

		const scannerContainer = container.getElementsByClassName("scan-region");

		expect(scannerContainer.item(0)?.classList.toString()).not.toContain("scan-region--visible");
	});
});
