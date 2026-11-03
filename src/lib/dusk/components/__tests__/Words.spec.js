import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/svelte";

import { Words } from "..";

describe("Words", () => {
  afterEach(cleanup);

  it('should render the "Words" component with underscores for empty string', () => {
    const { container } = render(Words, { props: { words: ["", "", ""] } });

    expect(container.firstElementChild).toBeInTheDocument();
  });
});
