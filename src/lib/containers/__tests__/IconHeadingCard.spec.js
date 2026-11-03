import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import { IconHeadingCard } from "../Cards";

describe("IconHeadingCard", () => {
  afterEach(cleanup);

  it("renders the IconHeadingCard component with a heading", () => {
    const { container } = render(IconHeadingCard, {
      props: {
        heading: "My Card",
      },
    });

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
