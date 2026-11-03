import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { Button } from "..";

describe("Button", () => {
  const baseProps = {
    text: "some text",
  };
  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it('should render the Button component using the type "button" as a default', () => {
    const { container } = render(Button, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
