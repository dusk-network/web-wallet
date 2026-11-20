import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";

import { CopyField } from "..";

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(""),
  },
});

describe("CopyField", () => {
  const baseProps = {
    disabled: false,
    displayValue: "1,234,567",
    name: "Sample Information",
    rawValue: "1234567",
  };

  afterEach(cleanup);

  it("copies the raw value on pressing the copy button", async () => {
    const { getByRole } = render(CopyField, {
      props: baseProps,
      target: document.body,
    });

    await fireEvent.click(getByRole("button"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("1234567");
  });
});
