import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { Icon } from "..";

describe("Icon", () => {
  const baseProps = {
    path: "M3,3H21V21H3V3M5,5V19H19V5H5Z",
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it("should pass additional class names and attributes to the rendered element", async () => {
    const props = {
      ...baseProps,
      className: "foo bar",
      "data-baz": "baz",
    };
    const { container, rerender } = render(Icon, { ...baseOptions, props });
    const icon = container.firstElementChild;

    expect(icon).toHaveClass("foo bar");
    expect(icon).toHaveAttribute("data-baz", "baz");

    await rerender({ ...props, isInStack: true });

    const icon2 = container.firstElementChild;

    expect(icon2).toHaveClass("foo bar");
    expect(icon2).toHaveAttribute("data-baz", "baz");
  });
});
