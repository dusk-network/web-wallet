import {
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { Textbox } from "..";

describe("Textbox", () => {
	const baseProps = {};
	const baseOptions = {
		props: baseProps,
		target: document.body
	};

	afterEach(cleanup);

	it("should render a Textbox of type \"text\" as a default", () => {
		const { container } = render(Textbox, baseOptions);

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should render a Textbox component of the desired type", () => {
		[
			"email",
			"hidden",
			"multiline",
			"number",
			"password",
			"search",
			"tel",
			"text",
			"url"
		].forEach(type => {
			const props = {
				...baseProps,
				type
			};
			const { container } = render(Textbox, { ...baseOptions, props });

			expect(container.firstChild).toMatchSnapshot();

			cleanup();
		});
	});

	it("should pass additional class names and attributes to the rendered element", () => {
		const props = {
			...baseProps,
			className: "foo bar",
			id: "some-id",
			value: "some textbox text"
		};
		const { container } = render(Textbox, { ...baseOptions, props });

		expect(container.firstChild).toMatchSnapshot();
	});

	it("should change value before forwarding the event", async () => {
		const initialValue = "some textbox text";
		const newValue = "new value";
		const props = {
			...baseProps,
			className: "foo bar",
			id: "some-id",
			value: initialValue
		};

		const changeHandler = vi.fn();

		const { component, getByRole } = render(Textbox, { ...baseOptions, props });

		const input = getByRole("textbox");

		expect(input).toHaveValue(initialValue);

		component.$on("input", changeHandler);

		await fireEvent.input(input, { target: { value: newValue } });

		expect(input).toHaveValue(newValue);

		expect(changeHandler).toHaveBeenCalledTimes(1);
		expect(changeHandler).toHaveBeenCalledWith(expect.objectContaining({
			target: expect.objectContaining({ value: newValue })
		}));
	});
});
