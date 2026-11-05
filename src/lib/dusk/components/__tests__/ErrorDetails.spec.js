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

  it("should keep the message from reordering what's read: anyone's node or wallet can write it", () => {
    const { container } = render(ErrorDetails, {
      error: new Error("refused \u202E0001\u202C"),
      summary: "Details",
    });

    expect(container.querySelector("pre")?.textContent).toContain(
      "refused \\u202e0001\\u202c"
    );
  });
});
