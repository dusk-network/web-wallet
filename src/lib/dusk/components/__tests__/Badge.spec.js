import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { Badge } from "..";

describe("Badge", () => {
  const baseProps = {
    text: "Badge",
  };

  afterEach(cleanup);

  it('should render the Badge component using the type "neutral" as a default', () => {
    const { container } = render(Badge, baseProps);

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
