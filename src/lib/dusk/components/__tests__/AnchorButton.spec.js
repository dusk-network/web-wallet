import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { AnchorButton } from "..";

describe("AnchorButton", () => {
  const baseProps = {
    href: "/some-url",
    text: "some text",
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };
  afterEach(cleanup);

  it("should render the AnchorButton component", () => {
    const { container } = render(AnchorButton, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();
  });

  it("should take a disabled link out of reach", () => {
    const { container } = render(AnchorButton, {
      ...baseOptions,
      props: { ...baseProps, disabled: true },
    });
    const link = container.firstElementChild;

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
  });
});
