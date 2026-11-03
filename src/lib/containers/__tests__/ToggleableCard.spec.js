import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { ToggleableCard } from "../Cards";

describe("IconHeadingCard", () => {
  afterEach(cleanup);

  it("renders the ToggleableCard component with a heading", () => {
    const { container } = render(ToggleableCard, {
      props: {
        heading: "My Card",
      },
    });

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
