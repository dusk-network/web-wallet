import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { computePosition, offset as setOffset } from "@floating-ui/dom";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

import { Tooltip } from "..";

vi.mock("@floating-ui/dom");
vi.useFakeTimers();

/** @param {Record<string, string>} dataset */
function createEventTarget (dataset) {
	const target = document.createElement("div");

	Object.keys(dataset).forEach(key => {
		target.dataset[key] = dataset[key];
	});

	return document.body.appendChild(target);
}

describe("Tooltip", () => {
	/** @type {import("svelte").ComponentProps<Tooltip>} */
	const baseProps = {
		defaultDelayHide: 300,
		defaultDelayShow: 500,
		defaultOffset: 12,
		defaultPlace: "bottom",
		defaultType: "success",
		id: "tooltip-id"
	};
	const baseOptions = {
		props: baseProps,
		target: document.body
	};

	/** @type {import("@floating-ui/dom").ComputePositionReturn} */
	const defaultComputedPosition = {
		middlewareData: {},
		placement: "left",
		strategy: "fixed",
		x: 999,
		y: 888
	};

	const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

	vi.mocked(computePosition).mockResolvedValue(defaultComputedPosition);

	afterEach(() => {
		cleanup();
		vi.mocked(computePosition).mockClear();
		vi.mocked(setOffset).mockClear();
		clearTimeoutSpy.mockClear();
	});

	afterAll(() => {
		vi.doUnmock("@floating-ui/dom");
		clearTimeoutSpy.mockRestore();
	});

	it("should render the Tooltip component", () => {
		const { getByRole } = render(Tooltip, baseOptions);

		expect(getByRole("tooltip", { hidden: true })).toMatchSnapshot();
	});

	it("should pass additional class names and attributes to the rendered element", () => {
		const props = {
			...baseProps,
			"className": "foo bar",
			"data-baz": "baz"
		};
		const { getByRole } = render(Tooltip, { ...baseOptions, props });
		const tooltip = getByRole("tooltip", { hidden: true });

		expect(tooltip).toHaveClass("foo bar");
		expect(tooltip).toHaveAttribute("data-baz", "baz");
		expect(tooltip).toMatchSnapshot();
	});

	it("shouldn't allow ovewriting the `left` and `top` style rules", () => {
		const expectedStyle = "color: red; left: 0px; top: 0px;";
		const props = {
			...baseProps,
			className: "foo bar",
			style: "color: red; left: 99px; top: 99px"
		};
		const { getByRole } = render(Tooltip, { ...baseOptions, props });

		expect(getByRole("tooltip", { hidden: true }).getAttribute("style")).toBe(expectedStyle);
	});

	it("should add event listeners to the document body when mounting and remove them when unmounting", () => {
		const addListenerSpy = vi.spyOn(document.body, "addEventListener");
		const removeListenerSpy = vi.spyOn(document.body, "removeEventListener");
		const { unmount } = render(Tooltip, baseOptions);
		const handlers = addListenerSpy.mock.calls.map(call => call[1]);

		expect(addListenerSpy).toHaveBeenCalledTimes(5);
		expect(addListenerSpy).toHaveBeenNthCalledWith(1, "focusin", expect.any(Function), true);
		expect(addListenerSpy).toHaveBeenNthCalledWith(2, "focusout", expect.any(Function), true);
		expect(addListenerSpy).toHaveBeenNthCalledWith(3, "keydown", expect.any(Function), true);
		expect(addListenerSpy).toHaveBeenNthCalledWith(4, "mouseenter", expect.any(Function), true);
		expect(addListenerSpy).toHaveBeenNthCalledWith(5, "mouseleave", expect.any(Function), true);

		unmount();

		expect(removeListenerSpy).toHaveBeenCalledTimes(5);

		expect(removeListenerSpy).toHaveBeenNthCalledWith(1, "focusin", handlers[0], true);
		expect(removeListenerSpy).toHaveBeenNthCalledWith(2, "focusout", handlers[1], true);
		expect(removeListenerSpy).toHaveBeenNthCalledWith(3, "keydown", handlers[2], true);
		expect(removeListenerSpy).toHaveBeenNthCalledWith(4, "mouseenter", handlers[3], true);
		expect(removeListenerSpy).toHaveBeenNthCalledWith(5, "mouseleave", handlers[4], true);

		addListenerSpy.mockRestore();
		removeListenerSpy.mockRestore();
	});

	describe("Tooltip show and hide events", () => {
		/** @type {HTMLElement} */
		let badTarget;

		/** @type {HTMLElement} */
		let target;

		const prevTooltipElement = document.body.appendChild(document.createElement("span"));
		const dataset = { tooltipId: "tooltip-id", tooltipText: "some text" };

		beforeEach(() => {
			badTarget = createEventTarget({ tooltipId: "fake-tooltip-id" });
			prevTooltipElement.setAttribute("aria-described-by", baseProps.id);
			target = createEventTarget(dataset);
		});

		describe("Tooltip show events", () => {
			it("should ignore mouse enter and focus-in events if the target element doesn't refer to the tooltip", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(document.body, { target: badTarget });
				await vi.advanceTimersToNextTimerAsync();

				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(badTarget.getAttribute("aria-described-by")).toBeNull();
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBe(baseProps.id);

				await fireEvent.mouseEnter(badTarget);
				await vi.advanceTimersToNextTimerAsync();

				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(badTarget.getAttribute("aria-described-by")).toBeNull();
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBe(baseProps.id);
				expect(clearTimeoutSpy).not.toHaveBeenCalled();
				expect(computePosition).not.toHaveBeenCalled();
			});

			it("should show the tooltip on a focus-in event if the target element refers to it", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(target);

				expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
				expect(computePosition).toHaveBeenCalledTimes(1);
				expect(computePosition).toHaveBeenCalledWith(
					target,
					tooltip,
					expect.objectContaining({ placement: baseProps.defaultPlace })
				);
				expect(setOffset).toHaveBeenCalledTimes(1);
				expect(setOffset).toHaveBeenCalledWith({ mainAxis: baseProps.defaultOffset });

				expect(tooltip).toHaveTextContent(dataset.tooltipText);
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBe(baseProps.id);

				await vi.advanceTimersByTimeAsync(Number(baseProps.defaultDelayShow));

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");
				expect(target.getAttribute("aria-described-by")).toBe(baseProps.id);
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBeNull();
			});

			it("should show the tooltip on a mouse enter event if the target element refers to it", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.mouseEnter(target);

				expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
				expect(computePosition).toHaveBeenCalledTimes(1);
				expect(computePosition).toHaveBeenCalledWith(
					target,
					tooltip,
					expect.objectContaining({ placement: baseProps.defaultPlace })
				);
				expect(setOffset).toHaveBeenCalledTimes(1);
				expect(setOffset).toHaveBeenCalledWith({ mainAxis: baseProps.defaultOffset });

				expect(tooltip).toHaveTextContent(dataset.tooltipText);
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBe(baseProps.id);

				await vi.advanceTimersByTimeAsync(Number(baseProps.defaultDelayShow));

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");
				expect(target.getAttribute("aria-described-by")).toBe(baseProps.id);
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBeNull();
			});

			it("should use attributes defined on the target element, if they are present, rather than the defaults", async () => {
				target.setAttribute("data-tooltip-delay-show", "700");
				target.setAttribute("data-tooltip-offset", "0");
				target.setAttribute("data-tooltip-place", "top");
				target.setAttribute("data-tooltip-type", "error");

				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.mouseEnter(target);

				expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
				expect(computePosition).toHaveBeenCalledTimes(1);
				expect(computePosition).toHaveBeenCalledWith(
					target,
					tooltip,
					expect.objectContaining({ placement: "top" })
				);
				expect(setOffset).toHaveBeenCalledTimes(1);
				expect(setOffset).toHaveBeenCalledWith({ mainAxis: 0 });

				expect(tooltip).toHaveTextContent(dataset.tooltipText);
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBe(baseProps.id);

				await vi.advanceTimersByTimeAsync(Number(baseProps.defaultDelayShow));

				expect(tooltip).toHaveTextContent(dataset.tooltipText);
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBe(baseProps.id);

				await vi.advanceTimersByTimeAsync(700 - Number(baseProps.defaultDelayShow));

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");
				expect(tooltip).toHaveClass("duk-tooltip-error");
				expect(target.getAttribute("aria-described-by")).toBe(baseProps.id);
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBeNull();
			});

			it("should not wait for a delay before showing if the value is zero", async () => {
				target.setAttribute("data-tooltip-delay-show", "0");

				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.mouseEnter(target);
				await tick();

				expect(tooltip).toHaveTextContent(dataset.tooltipText);
				expect(tooltip.getAttribute("aria-hidden")).toBe("false");
				expect(target.getAttribute("aria-described-by")).toBe(baseProps.id);
				expect(prevTooltipElement.getAttribute("aria-described-by")).toBeNull();
			});
		});

		describe("Tooltip hide events", () => {
			it("should ignore mouse leave and focus-out events if the target element doesn't refer to the tooltip", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.mouseEnter(document.body, { target });
				await vi.advanceTimersToNextTimerAsync();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.focusOut(document.body, { target: badTarget });
				await vi.advanceTimersToNextTimerAsync();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.mouseLeave(document.body, { target: badTarget });
				await vi.advanceTimersToNextTimerAsync();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");
			});

			it("should hide the tooltip on a focus-out event if the target element refers to it", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(target);
				await vi.advanceTimersToNextTimerAsync();

				clearTimeoutSpy.mockClear();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.focusOut(target);

				expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

				await vi.advanceTimersByTimeAsync(Number(baseProps.defaultDelayHide));

				expect(tooltip).toHaveTextContent("");
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
			});

			it("should hide the tooltip on a mouse leave event if the target element refers to it", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(target);
				await vi.advanceTimersToNextTimerAsync();

				clearTimeoutSpy.mockClear();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.mouseLeave(target);

				expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

				await vi.advanceTimersByTimeAsync(Number(baseProps.defaultDelayHide));

				expect(tooltip).toHaveTextContent("");
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
			});

			it("should use the hide delay on the target element, if present, rather than the default", async () => {
				target.setAttribute("data-tooltip-delay-hide", "700");

				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(target);
				await vi.advanceTimersToNextTimerAsync();

				clearTimeoutSpy.mockClear();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.mouseLeave(target);

				expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

				await vi.advanceTimersByTimeAsync(Number(baseProps.defaultDelayHide));

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await vi.advanceTimersByTimeAsync(700 - Number(baseProps.defaultDelayHide));

				expect(tooltip).toHaveTextContent("");
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
			});

			it("should not wait for a delay before hiding if the value is zero", async () => {
				target.setAttribute("data-tooltip-delay-hide", "0");

				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(target);
				await vi.advanceTimersToNextTimerAsync();

				clearTimeoutSpy.mockClear();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.mouseLeave(target);
				await tick();

				expect(tooltip).toHaveTextContent("");
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
			});

			it("should hide the tooltip if the user presses the escape key", async () => {
				const { getByRole } = render(Tooltip, baseOptions);
				const tooltip = getByRole("tooltip", { hidden: true });

				await fireEvent.focusIn(target);
				await vi.advanceTimersToNextTimerAsync();

				clearTimeoutSpy.mockClear();

				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.keyDown(target, { key: "a" });
				await vi.advanceTimersToNextTimerAsync();

				expect(clearTimeoutSpy).not.toHaveBeenCalled();
				expect(tooltip.getAttribute("aria-hidden")).toBe("false");

				await fireEvent.keyDown(target, { key: "Escape" });
				await vi.advanceTimersToNextTimerAsync();

				expect(tooltip).toHaveTextContent("");
				expect(tooltip.getAttribute("aria-hidden")).toBe("true");
				expect(target.getAttribute("aria-described-by")).toBeNull();
			});
		});
	});
});
