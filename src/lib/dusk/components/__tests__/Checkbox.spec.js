import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { Checkbox } from "..";

describe("Checkbox", () => {
  const baseProps = {
    id: "test",
    name: "test",
  };

  afterEach(cleanup);

  it("renders the Checkbox component and can transition to a checked state on click", async () => {
    const { getByRole } = render(Checkbox, {
      props: { ...baseProps, checked: false },
    });
    const checkbox = getByRole("checkbox");

    expect(checkbox).not.toBeChecked();
    await fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
