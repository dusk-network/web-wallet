import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { ErrorDetails } from "..";

describe("ErrorDetails", () => {
  const baseProps = {
    error: new Error("Some error messaage"),
    summary: "Some error summary",
  };

  const baseOptions = {
    props: baseProps,
    target: document.body,
  };

  afterEach(cleanup);

  it("should render the `ErrorDetails` component", () => {
    const { container } = render(ErrorDetails, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
