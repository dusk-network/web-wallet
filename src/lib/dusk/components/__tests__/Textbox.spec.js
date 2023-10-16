import {
	afterEach,
	describe,
	expect,
	it
} from "vitest";
import { cleanup, render } from "@testing-library/svelte";

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
});
