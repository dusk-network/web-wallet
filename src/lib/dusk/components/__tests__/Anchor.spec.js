import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/svelte";

import { renderWithSimpleContent } from "$lib/dusk/test-helpers";

import { Anchor } from "..";

describe("Anchor", () => {
  const baseProps = {
    href: "https://example.com",
  };

  const baseOptions = {
    props: baseProps,
  };

  afterEach(cleanup);

  it("should render the Anchor component", () => {
    const { container } = renderWithSimpleContent(Anchor, baseOptions);

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
